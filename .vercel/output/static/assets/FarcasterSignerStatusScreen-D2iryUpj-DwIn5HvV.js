import{d6 as F,d7 as T,d9 as I,db as d,dF as k,d8 as t,dH as x,dC as B,dB as n}from"./index-DhRHqroX.js";import{h as O}from"./CopyToClipboard-DSTf_eKU-CmpQnlU2.js";import{n as q}from"./OpenLink-DZHy38vr-DsmF45SN.js";import{C as E}from"./QrCode-pKF9uy8S-F6dG872j.js";import{n as _}from"./ScreenLayout-rsaLrlHW-Bkh4r0qM.js";import{l as h}from"./farcaster-DPlSjvF5-CQ8_nXiz.js";import"./dijkstra-COg3n3zL.js";import"./ModalHeader-CPVs-20G-DQnBeNVR.js";import"./Screen-CkHwbpUl-Dtnc1tkG.js";import"./index-Dq_xe9dz-BrzrCQW5.js";let S="#8a63d2";const M=({appName:u,loading:m,success:i,errorMessage:e,connectUri:r,onBack:s,onClose:c,onOpenFarcaster:o})=>t.jsx(_,x.isMobile||m?x.isIOS?{title:e?e.message:"Add a signer to Farcaster",subtitle:e?e.detail:`This will allow ${u} to add casts, likes, follows, and more on your behalf.`,icon:h,iconVariant:"loading",iconLoadingStatus:{success:i,fail:!!e},primaryCta:r&&o?{label:"Open Farcaster app",onClick:o}:void 0,onBack:s,onClose:c,watermark:!0}:{title:e?e.message:"Requesting signer from Farcaster",subtitle:e?e.detail:"This should only take a moment",icon:h,iconVariant:"loading",iconLoadingStatus:{success:i,fail:!!e},onBack:s,onClose:c,watermark:!0,children:r&&x.isMobile&&t.jsx(A,{children:t.jsx(q,{text:"Take me to Farcaster",url:r,color:S})})}:{title:"Add a signer to Farcaster",subtitle:`This will allow ${u} to add casts, likes, follows, and more on your behalf.`,onBack:s,onClose:c,watermark:!0,children:t.jsxs(R,{children:[t.jsx(L,{children:r?t.jsx(E,{url:r,size:275,squareLogoElement:h}):t.jsx(V,{children:t.jsx(B,{})})}),t.jsxs(N,{children:[t.jsx(P,{children:"Or copy this link and paste it into a phone browser to open the Farcaster app."}),r&&t.jsx(O,{text:r,itemName:"link",color:S})]})]})});let A=n.div`
  margin-top: 24px;
`,R=n.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
`,L=n.div`
  padding: 24px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 275px;
`,N=n.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
`,P=n.div`
  font-size: 0.875rem;
  text-align: center;
  color: var(--privy-color-foreground-2);
`,V=n.div`
  position: relative;
  width: 82px;
  height: 82px;
`;const Y={component:()=>{let{lastScreen:u,navigateBack:m,data:i}=F(),e=T(),{requestFarcasterSignerStatus:r,closePrivyModal:s}=I(),[c,o]=d.useState(void 0),[b,v]=d.useState(!1),[j,y]=d.useState(!1),g=d.useRef([]),a=i==null?void 0:i.farcasterSigner;d.useEffect((()=>{let w=Date.now(),l=setInterval((async()=>{if(!(a!=null&&a.public_key))return clearInterval(l),void o({retryable:!0,message:"Connect failed",detail:"Something went wrong. Please try again."});a.status==="approved"&&(clearInterval(l),v(!1),y(!0),g.current.push(setTimeout((()=>s({shouldCallAuthOnSuccess:!1,isSuccess:!0})),k)));let p=await r(a==null?void 0:a.public_key),C=Date.now()-w;p.status==="approved"?(clearInterval(l),v(!1),y(!0),g.current.push(setTimeout((()=>s({shouldCallAuthOnSuccess:!1,isSuccess:!0})),k))):C>3e5?(clearInterval(l),o({retryable:!0,message:"Connect failed",detail:"The request timed out. Try again."})):p.status==="revoked"&&(clearInterval(l),o({retryable:!0,message:"Request rejected",detail:"The request was rejected. Please try again."}))}),2e3);return()=>{clearInterval(l),g.current.forEach((p=>clearTimeout(p)))}}),[]);let f=(a==null?void 0:a.status)==="pending_approval"?a.signer_approval_url:void 0;return t.jsx(M,{appName:e.name,loading:b,success:j,errorMessage:c,connectUri:f,onBack:u?m:void 0,onClose:s,onOpenFarcaster:()=>{f&&(window.location.href=f)}})}};export{Y as FarcasterSignerStatusScreen,M as FarcasterSignerStatusView,Y as default};
