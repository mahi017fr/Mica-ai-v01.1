import{dJ as Y,d6 as G,d7 as Z,d9 as ee,db as l,dd as u,dS as re,dF as F,d8 as t,dH as $,dC as te,dB as s}from"./index-DhRHqroX.js";import{n as ae}from"./OpenLink-DZHy38vr-DsmF45SN.js";import{C as ie}from"./QrCode-pKF9uy8S-F6dG872j.js";import{$ as oe}from"./ModalHeader-CPVs-20G-DQnBeNVR.js";import{r as se}from"./LabelXs-oqZNqbm_-D83khnQC.js";import{a as ne}from"./shouldProceedtoEmbeddedWalletCreationFlow-DI14BPMB-qRg-05Xg.js";import{n as le}from"./ScreenLayout-rsaLrlHW-Bkh4r0qM.js";import{l as O}from"./farcaster-DPlSjvF5-CQ8_nXiz.js";import{C as ce}from"./check-CFrq-bW0.js";import{C as de}from"./copy-DcynFTrr.js";import"./dijkstra-COg3n3zL.js";import"./Screen-CkHwbpUl-Dtnc1tkG.js";import"./index-Dq_xe9dz-BrzrCQW5.js";import"./createLucideIcon-QhLwTfsg.js";let ue=s.div`
  width: 100%;
`,pe=s.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem;
  height: 56px;
  background: ${r=>r.$disabled?"var(--privy-color-background-2)":"var(--privy-color-background)"};
  border: 1px solid var(--privy-color-foreground-4);
  border-radius: var(--privy-border-radius-md);

  &:hover {
    border-color: ${r=>r.$disabled?"var(--privy-color-foreground-4)":"var(--privy-color-foreground-3)"};
  }
`,me=s.div`
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
`,J=s.span`
  display: block;
  font-size: 16px;
  line-height: 24px;
  color: ${r=>r.$disabled?"var(--privy-color-foreground-2)":"var(--privy-color-foreground)"};
  overflow: hidden;
  text-overflow: ellipsis;
  /* Use single-line truncation without nowrap to respect container width */
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  word-break: break-all;

  @media (min-width: 441px) {
    font-size: 14px;
    line-height: 20px;
  }
`,he=s(J)`
  color: var(--privy-color-foreground-3);
  font-style: italic;
`,fe=s(se)`
  margin-bottom: 0.5rem;
`,ge=s(oe)`
  && {
    gap: 0.375rem;
    font-size: 14px;
    flex-shrink: 0;
  }
`;const ve=({value:r,title:p,placeholder:c,className:a,showCopyButton:d=!0,truncate:o,maxLength:m=40,disabled:h=!1})=>{let[n,x]=l.useState(!1),w=o&&r?((i,E,f)=>{if((i=i.startsWith("https://")?i.slice(8):i).length<=f)return i;if(E==="middle"){let y=Math.ceil(f/2)-2,C=Math.floor(f/2)-1;return`${i.slice(0,y)}...${i.slice(-C)}`}return`${i.slice(0,f-3)}...`})(r,o,m):r;return l.useEffect((()=>{if(n){let i=setTimeout((()=>x(!1)),3e3);return()=>clearTimeout(i)}}),[n]),t.jsxs(ue,{className:a,children:[p&&t.jsx(fe,{children:p}),t.jsxs(pe,{$disabled:h,children:[t.jsx(me,{children:r?t.jsx(J,{$disabled:h,title:r,children:w}):t.jsx(he,{$disabled:h,children:c||"No value"})}),d&&r&&t.jsx(ge,{onClick:function(i){i.stopPropagation(),navigator.clipboard.writeText(r).then((()=>x(!0))).catch(console.error)},size:"sm",children:t.jsxs(t.Fragment,n?{children:["Copied",t.jsx(ce,{size:14})]}:{children:["Copy",t.jsx(de,{size:14})]})})]})]})},xe=({connectUri:r,loading:p,success:c,errorMessage:a,onBack:d,onClose:o,onOpenFarcaster:m})=>t.jsx(le,$.isMobile||p?$.isIOS?{title:a?a.message:"Sign in with Farcaster",subtitle:a?a.detail:"To sign in with Farcaster, please open the Farcaster app.",icon:O,iconVariant:"loading",iconLoadingStatus:{success:c,fail:!!a},primaryCta:r&&m?{label:"Open Farcaster app",onClick:m}:void 0,onBack:d,onClose:o,watermark:!0}:{title:a?a.message:"Signing in with Farcaster",subtitle:a?a.detail:"This should only take a moment",icon:O,iconVariant:"loading",iconLoadingStatus:{success:c,fail:!!a},onBack:d,onClose:o,watermark:!0,children:r&&$.isMobile&&t.jsx(ye,{children:t.jsx(ae,{text:"Take me to Farcaster",url:r,color:"#8a63d2"})})}:{title:"Sign in with Farcaster",subtitle:"Scan with your phone's camera to continue.",onBack:d,onClose:o,watermark:!0,children:t.jsxs(be,{children:[t.jsx(Se,{children:r?t.jsx(ie,{url:r,size:275,squareLogoElement:O}):t.jsx(Ce,{children:t.jsx(te,{})})}),t.jsxs(we,{children:[t.jsx(Ee,{children:"Or copy this link and paste it into a phone browser to open the Farcaster app."}),r&&t.jsx(ve,{value:r,truncate:"end",maxLength:30,showCopyButton:!0,disabled:!0})]})]})}),De={component:()=>{let{authenticated:r,logout:p,ready:c,user:a}=Y(),{lastScreen:d,navigate:o,navigateBack:m,setModalData:h}=G(),n=Z(),{getAuthFlow:x,loginWithFarcaster:w,closePrivyModal:i,createAnalyticsEvent:E}=ee(),[f,y]=l.useState(void 0),[C,Q]=l.useState(!1),[b,K]=l.useState(!1),T=l.useRef([]),S=x(),k=S==null?void 0:S.meta.connectUri;return l.useEffect((()=>{let g=Date.now(),j=setInterval((async()=>{var _,R,I,L,N,U,M,D,z,B,W,q,V,H,P;let A=await S.pollForReady.execute(),X=Date.now()-g;if(A){clearInterval(j),Q(!0);try{await w(),K(!0)}catch(e){let v={retryable:!1,message:"Authentication failed"};if((e==null?void 0:e.privyErrorCode)===u.ALLOWLIST_REJECTED)return void o("AllowlistRejectionScreen");if((e==null?void 0:e.privyErrorCode)===u.USER_LIMIT_REACHED)return console.error(new re(e).toString()),void o("UserLimitReachedScreen");if((e==null?void 0:e.privyErrorCode)===u.USER_DOES_NOT_EXIST)return void o("AccountNotFoundScreen");if((e==null?void 0:e.privyErrorCode)===u.LINKED_TO_ANOTHER_USER)v.detail=e.message??"This account has already been linked to another user.";else{if((e==null?void 0:e.privyErrorCode)===u.ACCOUNT_TRANSFER_REQUIRED&&((R=(_=e.data)==null?void 0:_.data)!=null&&R.nonce))return h({accountTransfer:{nonce:(L=(I=e.data)==null?void 0:I.data)==null?void 0:L.nonce,account:(U=(N=e.data)==null?void 0:N.data)==null?void 0:U.subject,displayName:(z=(D=(M=e.data)==null?void 0:M.data)==null?void 0:D.account)==null?void 0:z.displayName,linkMethod:"farcaster",embeddedWalletAddress:(q=(W=(B=e.data)==null?void 0:B.data)==null?void 0:W.otherUser)==null?void 0:q.embeddedWalletAddress,farcasterEmbeddedAddress:(P=(H=(V=e.data)==null?void 0:V.data)==null?void 0:H.otherUser)==null?void 0:P.farcasterEmbeddedAddress}}),void o("LinkConflictScreen");(e==null?void 0:e.privyErrorCode)===u.INVALID_CREDENTIALS?(v.retryable=!0,v.detail="Something went wrong. Try again."):(e==null?void 0:e.privyErrorCode)===u.TOO_MANY_REQUESTS&&(v.detail="Too many requests. Please wait before trying again.")}y(v)}}else X>12e4&&(clearInterval(j),y({retryable:!0,message:"Authentication failed",detail:"The request timed out. Try again."}))}),2e3);return()=>{clearInterval(j),T.current.forEach((A=>clearTimeout(A)))}}),[]),l.useEffect((()=>{if(c&&r&&b&&a){if(n!=null&&n.legal.requireUsersAcceptTerms&&!a.hasAcceptedTerms){let g=setTimeout((()=>{o("AffirmativeConsentScreen")}),F);return()=>clearTimeout(g)}b&&(ne(a,n.embeddedWallets)?T.current.push(setTimeout((()=>{h({createWallet:{onSuccess:()=>{},onFailure:g=>{console.error(g),E({eventName:"embedded_wallet_creation_failure_logout",payload:{error:g,screen:"FarcasterConnectStatusScreen"}}),p()},callAuthOnSuccessOnClose:!0}}),o("EmbeddedWalletOnAccountCreateScreen")}),F)):T.current.push(setTimeout((()=>i({shouldCallAuthOnSuccess:!0,isSuccess:!0})),F)))}}),[b,c,r,a]),t.jsx(xe,{connectUri:k,loading:C,success:b,errorMessage:f,onBack:d?m:void 0,onClose:i,onOpenFarcaster:()=>{k&&(window.location.href=k)}})}};let ye=s.div`
  margin-top: 24px;
`,be=s.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
`,Se=s.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 275px;
`,we=s.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
`,Ee=s.div`
  font-size: 0.875rem;
  text-align: center;
  color: var(--privy-color-foreground-2);
`,Ce=s.div`
  position: relative;
  width: 82px;
  height: 82px;
`;export{De as FarcasterConnectStatusScreen,xe as FarcasterConnectStatusView,De as default};
