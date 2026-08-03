// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Arc Network per-deal USDC escrow with a 24h timelock auto-release.
//
// Design constraints (see the AI deal-workflow requirements):
//   - Custody is a dedicated escrow contract PER DEAL, created through the
//     DealEscrowFactory so the client never owns keys.
//   - The 24h review window is enforced by block.timestamp ON CHAIN
//     (`deadline`). The dApp state layer mirrors it, but the contract is the
//     final authority: `autoRelease()` reverts if called before `deadline`.
//   - Buyer posts `amount` (the price). Seller posts `collateral` (100% of the
//     deal by default, symmetric mutual collateral).
//   - No release is possible while `disputed`.
//   - `settle()` exists for a future arbiter; with a zero arbiter it is
//     unusable, so funds can never be moved unilaterally.

interface IUSDC {
    function balanceOf(address owner) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
}

contract DealEscrow {
    IUSDC public immutable usdc;
    address public immutable buyer;
    address public immutable seller;
    address public immutable arbiter;

    uint256 public immutable amount;       // buyer price (USDC, 6 dp)
    uint256 public immutable collateral;   // seller collateral (USDC, 6 dp)
    uint256 public immutable reviewWindow; // seconds (24h = 86400)

    uint256 public deadline; // 0 until the review window starts
    bool public disputed;
    bool public released;

    mapping(address => uint256) public deposited;

    event Funded(address indexed who, uint256 amount);
    event ReviewStarted(uint256 deadline);
    event Released(uint256 sellerAmount, uint256 collateralReturn);
    event Disputed(address indexed by);
    event Settled(address indexed to, uint256 amount);

    modifier onlyParty() {
        require(msg.sender == buyer || msg.sender == seller, "DealEscrow: not a party");
        _;
    }

    constructor(
        address _buyer,
        address _seller,
        address _usdc,
        address _arbiter,
        uint256 _amount,
        uint256 _collateral,
        uint256 _reviewWindow
    ) {
        require(_buyer != address(0) && _seller != address(0), "DealEscrow: zero party");
        require(_usdc != address(0), "DealEscrow: zero usdc");
        buyer = _buyer;
        seller = _seller;
        usdc = IUSDC(_usdc);
        arbiter = _arbiter;
        amount = _amount;
        collateral = _collateral;
        reviewWindow = _reviewWindow;
    }

    function deposit() external onlyParty {
        require(deposited[msg.sender] == 0, "DealEscrow: already funded");
        uint256 expected = msg.sender == buyer ? amount : collateral;
        require(expected > 0, "DealEscrow: no obligation");
        uint256 before = usdc.balanceOf(address(this));
        require(usdc.transferFrom(msg.sender, address(this), expected), "DealEscrow: transfer failed");
        require(usdc.balanceOf(address(this)) == before + expected, "DealEscrow: underfunded");
        deposited[msg.sender] = expected;
        emit Funded(msg.sender, expected);
    }

    function funded() public view returns (bool) {
        return deposited[buyer] == amount && deposited[seller] == collateral;
    }

    function totalDeposited() public view returns (uint256) {
        return deposited[buyer] + deposited[seller];
    }

    function reviewStarted() public view returns (bool) {
        return deadline != 0;
    }

    function startReviewPeriod() external onlyParty {
        require(funded(), "DealEscrow: not fully funded");
        require(!disputed, "DealEscrow: disputed");
        require(deadline == 0, "DealEscrow: already started");
        deadline = block.timestamp + reviewWindow;
        emit ReviewStarted(deadline);
    }

    function _paySeller(uint256 sellerAmount, uint256 collateralReturn) internal {
        require(funded(), "DealEscrow: not fully funded");
        require(!disputed, "DealEscrow: disputed");
        require(!released, "DealEscrow: already released");
        require(reviewStarted(), "DealEscrow: review not started");
        released = true;
        deposited[buyer] = 0;
        deposited[seller] = 0;
        require(
            usdc.transfer(seller, sellerAmount + collateralReturn),
            "DealEscrow: payout failed"
        );
        emit Released(sellerAmount, collateralReturn);
    }

    function buyerRelease() external {
        require(msg.sender == buyer, "DealEscrow: only buyer");
        _paySeller(amount, collateral);
    }

    function autoRelease() external {
        require(!disputed, "DealEscrow: disputed");
        require(reviewStarted(), "DealEscrow: review not started");
        require(block.timestamp >= deadline, "DealEscrow: too early");
        _paySeller(amount, collateral);
    }

    function dispute() external onlyParty {
        require(!disputed, "DealEscrow: already disputed");
        require(!released, "DealEscrow: already released");
        disputed = true;
        emit Disputed(msg.sender);
    }

    function refund() external onlyParty {
        require(!released, "DealEscrow: already released");
        require(!reviewStarted(), "DealEscrow: review already started");
        uint256 amt = deposited[msg.sender];
        require(amt > 0, "DealEscrow: nothing deposited");
        deposited[msg.sender] = 0;
        require(usdc.transfer(msg.sender, amt), "DealEscrow: refund failed");
    }

    function settle(uint256 sellerAmount, uint256 buyerAmount) external {
        require(msg.sender == arbiter && arbiter != address(0), "DealEscrow: only arbiter");
        require(!released, "DealEscrow: already released");
        released = true;
        deposited[buyer] = 0;
        deposited[seller] = 0;
        if (sellerAmount > 0) {
            require(usdc.transfer(seller, sellerAmount), "DealEscrow: seller transfer failed");
            emit Settled(seller, sellerAmount);
        }
        if (buyerAmount > 0) {
            require(usdc.transfer(buyer, buyerAmount), "DealEscrow: buyer transfer failed");
            emit Settled(buyer, buyerAmount);
        }
    }
}

contract DealEscrowFactory {
    IUSDC public immutable usdc;
    address public immutable arbiter;
    uint256 public immutable reviewWindow;

    event DealCreated(uint256 indexed dealId, address escrow);

    constructor(address _usdc, address _arbiter, uint256 _reviewWindow) {
        require(_usdc != address(0), "DealEscrowFactory: zero usdc");
        usdc = IUSDC(_usdc);
        arbiter = _arbiter;
        reviewWindow = _reviewWindow;
    }

    function createDeal(
        uint256 dealId,
        address buyer,
        address seller,
        uint256 amount,
        uint256 collateral,
        address arbiter_
    ) external returns (address escrow) {
        require(buyer != address(0) && seller != address(0), "DealEscrowFactory: zero party");
        require(amount > 0 && collateral > 0, "DealEscrowFactory: zero amounts");
        DealEscrow e = new DealEscrow(
            buyer,
            seller,
            address(usdc),
            arbiter_,
            amount,
            collateral,
            reviewWindow
        );
        emit DealCreated(dealId, address(e));
        return address(e);
    }
}
