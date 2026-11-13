import{gT as te,d9 as y,db as m,gU as ne,d6 as oe,d8 as r,gV as R,dC as se,dB as f,gW as ae,gX as ie,dk as le}from"./index-DhRHqroX.js";import{i as T,d as Q,t as Y,l as H,y as K,c as L,n as ce,a as G,s as de,Q as J,m as ue,g as N,p as j,f as U,v as M,u as A,h as D,b as I}from"./styles-B5IHPi7e-BTG4dH38.js";import{n as S}from"./ScreenLayout-rsaLrlHW-Bkh4r0qM.js";import{n as Z}from"./styles-DVyDvTdj-eMT1pIrY.js";import{m as pe}from"./ModalHeader-CPVs-20G-DQnBeNVR.js";import{C as me}from"./QrCode-pKF9uy8S-F6dG872j.js";import{u as fe,a as he,s as ye,b as ge,c as be,d as _e,e as xe,f as Ce,g as Ee,F as ve}from"./floating-ui.react-YkGDvXzG.js";import{p as ke}from"./CopyableText-CQapvaMr-4TK9WoHP.js";import{T as F}from"./triangle-alert-C-P9Q7Lm.js";import{c as $}from"./createLucideIcon-QhLwTfsg.js";import{C as P}from"./check-CFrq-bW0.js";import{H as Se}from"./hourglass-Ow7W2R7C.js";import{C as we}from"./chevron-down-DabGudyd.js";import{n as Te,o as Ne,p as je,s as Ue}from"./floating-ui.react-dom-BkH8t9BE.js";import"./Screen-CkHwbpUl-Dtnc1tkG.js";import"./index-Dq_xe9dz-BrzrCQW5.js";import"./dijkstra-COg3n3zL.js";import"./copy-DcynFTrr.js";const E=te((()=>null)),w=e=>{E.getState()!==null&&E.setState(e)};async function Ae(e,t){let n=await e.fetchPrivyRoute(ne,{}),o={config:{status:"ready",data:{currencies:n.currencies,chains:n.chains}}};t!=null&&t.aborted||w(o)}function g(){let e=E(),{closePrivyModal:t,createAnalyticsEvent:n,privy:o}=y(),i=(e==null?void 0:e.params)??null,d=(e==null?void 0:e.config)??{status:"loading"},l=m.useCallback((a=>{let s=E.getState();s&&(w({modalState:a}),s.modalState.step!==a.step&&n({eventName:"sdk_deposit_address_step_viewed",payload:{entrySource:s.entrySource,step:a.step,...a.step==="error"?{errorCode:a.code}:{}}}))}),[n]),c=m.useCallback((async()=>{let a=e==null?void 0:e.controller;if(i&&a&&!a.signal.aborted){w({config:{status:"loading"}});try{await Ae(o,a.signal)}catch(s){if(a.signal.aborted)return;throw w({config:{status:"error",error:s instanceof Error?s:Error("Failed to load deposit config")}}),s}}}),[i,o,e==null?void 0:e.controller]),u=m.useCallback((()=>{if(!e)return;let{modalState:a}=e;n({eventName:"sdk_deposit_address_exited",payload:{entrySource:e.entrySource,step:a.step,...a.step==="error"?{errorCode:a.code}:{}}}),a.step==="complete"?e.onComplete():a.step==="failed"?e.onError(Error("DEPOSIT_FAILED")):a.step==="error"?e.onError(Error(a.code)):a.step==="refunded"?e.onError(Error("DEPOSIT_REFUNDED")):e.onError(Error("USER_EXITED")),t({shouldCallAuthOnSuccess:!1})}),[e,t,n]);return{modalState:(e==null?void 0:e.modalState)??{step:"intro"},setModalState:l,config:d,retryConfig:c,params:i,entrySource:(e==null?void 0:e.entrySource)??"direct",close:u,onBack:e==null?void 0:e.onBack}}function v(e){let{modalState:t,config:n,params:o,...i}=g();if((function(d,l){if(d.step!==l)throw Error("UNEXPECTED_STATE")})(t,e),!o||n.status!=="ready")throw Error("UNEXPECTED_STATE");return{state:t,configData:n.data,params:o,...i}}/**
 * @license lucide-react v0.554.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const De=[["path",{d:"m18 15-6-6-6 6",key:"153udz"}]],Ie=$("chevron-up",De);/**
 * @license lucide-react v0.554.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Oe=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 16v-4",key:"1dtifu"}],["path",{d:"M12 8h.01",key:"e9boi3"}]],Re=$("info",Oe);/**
 * @license lucide-react v0.554.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Fe=[["path",{d:"M9 14 4 9l5-5",key:"102s5s"}],["path",{d:"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11",key:"f3b9sd"}]],$e=$("undo-2",Fe);class Pe extends m.Component{static getDerivedStateFromError(){return{hasError:!0}}componentDidCatch(t,n){this.props.onError(t)}componentDidUpdate(t){t.resetKey!==this.props.resetKey&&this.state.hasError&&this.setState({hasError:!1})}render(){return this.state.hasError?null:this.props.children}constructor(...t){super(...t),this.state={hasError:!1}}}function Le(e,t,n){let o=Number(e);return!Number.isFinite(o)||o===0?`1 ${t} ≈ ${e} ${n}`:o>=.01?`1 ${t} ≈ ${B(o)} ${n}`:`${B(1/o)} ${t} ≈ 1 ${n}`}function B(e){return e>=1e3?new Intl.NumberFormat("en-US",{maximumFractionDigits:0}).format(Math.round(e)):e>=100?new Intl.NumberFormat("en-US",{maximumFractionDigits:1}).format(e):e>=1?new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(e):new Intl.NumberFormat("en-US",{maximumFractionDigits:4}).format(e)}function V(e,t){let n=Number(e);if(!Number.isFinite(n)||n===0)return e;let o=t!=null?n/10**t:n;return o>=1e3?new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(o):o>=1?new Intl.NumberFormat("en-US",{maximumFractionDigits:4}).format(o):o>=1e-4?new Intl.NumberFormat("en-US",{maximumFractionDigits:6}).format(o):new Intl.NumberFormat("en-US",{maximumSignificantDigits:4}).format(o)}function O({address:e,caip2:t,config:n}){for(let o of n.currencies){let i=o.chains.find((d=>d.caip2===t&&d.address.toLowerCase()===e.toLowerCase()));if(i)return{symbol:o.symbol.toUpperCase(),decimals:i.decimals}}return{symbol:e,decimals:void 0}}function z(e,t){var n;return((n=t[e])==null?void 0:n.displayName)??e}function W(e,t){return e.chains.filter((n=>n.can_be_relay_deposit_source===!0)).map((n=>{let o=t.chains[n.caip2];return o?{caip2:n.caip2,displayName:o.displayName,iconUrl:o.iconUrl,vmType:o.vmType,currencyAddress:n.address,currencyDecimals:n.decimals}:null})).filter((n=>n!==null))}function q(e,t){if(!e.chains[t.destinationChain])return`Unsupported destination chain: "${t.destinationChain}". Check that the chain is in CAIP-2 format (e.g. "eip155:8453") and is supported for deposit addresses.`;let n=t.destinationCurrency.toLowerCase();return e.currencies.some((o=>o.chains.some((i=>i.caip2===t.destinationChain&&i.address.toLowerCase()===n))))?null:`Unsupported destination currency "${t.destinationCurrency}" on chain "${t.destinationChain}". Check that this token address is supported on the specified chain.`}let Me=new Set(["ROUTE_UNAVAILABLE","UNEXPECTED_STATE","TIMEOUT_WAITING_FOR_NEXT_ORDER","TIMEOUT_ORDER_COMPLETION","DEPOSIT_FAILED","DEPOSIT_REFUNDED","USER_EXITED","AMOUNT_TOO_LOW","INSUFFICIENT_LIQUIDITY","UNSUPPORTED_CHAIN","UNSUPPORTED_CURRENCY","UNSUPPORTED_ROUTE","NO_SWAP_ROUTES_FOUND","NO_INTERNAL_SWAP_ROUTES_FOUND","NO_QUOTES","SANCTIONED_WALLET_ADDRESS","REFUND_WALLET_CREATION_FAILED","DEPOSIT_ADDRESSES_NOT_ENABLED","NOT_AUTHENTICATED"]);function Be(e){return Me.has(e)}function X(e){return Be(e)?e:"UNKNOWN_ERROR"}function ee(){let{params:e,setModalState:t}=g(),{privy:n}=y(),o=(function(){let{privy:l,refreshSessionAndUser:c}=y();return m.useCallback(((u,a)=>a?Promise.resolve({ok:!0,address:a}):R.resolveRefundAddress({privy:l,caip2:u,onWalletCreated:c})),[l,c])})(),[i,d]=m.useState(!1);return{fetchQuote:m.useCallback((async(l,c,u)=>{if(e){d(!0);try{let a=await o(l.caip2,e.refundAddress);if(!a.ok)return void t({step:"error",code:X(a.error)});let s=await n.fetchPrivyRoute(ae,{body:{source_chain:l.caip2,source_currency:l.currencyAddress,destination_chain:e.destinationChain,destination_currency:e.destinationCurrency,destination_address:e.destinationAddress,refund_address:a.address,...e.slippageBps!=null?{slippage_bps:e.slippageBps}:{}}});t({step:"address",selectedCurrency:c,selectedChain:l,availableChains:u,quote:s})}catch(a){let s=a instanceof Error?a:Error(String(a)),p="status"in s&&typeof s.status=="number"?s.status:void 0;t({step:"error",code:s instanceof ie&&s.code==="feature_not_enabled"?"DEPOSIT_ADDRESSES_NOT_ENABLED":p&&p>=500?"UNKNOWN_ERROR":X(s.message),message:s.message})}finally{d(!1)}}}),[e,n,o,t]),isFetching:i}}function re(e,t){switch(e.status){case"completed":return t({step:"complete",order:e});case"refunded":return t({step:"refunded",order:e});case"failed":return t({step:"failed",order:e});case"executing":return t({step:"processing",order:e});default:return}}const Ve=({sourceAmount:e,sourceSymbol:t,sourceChainName:n,sourceDecimals:o,destinationAmount:i,destSymbol:d,destChainName:l,destDecimals:c,onClose:u})=>r.jsx(T,{icon:P,iconVariant:"success",title:"Transfer complete",subtitle:i?`Received ${V(e,o)} ${t} on ${n} and converted it to ${V(i,c)} ${d} on ${l}. Funds are available to use.`:`Your ${t} has been received and is now available in your wallet.`,showClose:!0,onClose:u,primaryCta:{label:"Done",onClick:u},watermark:!1});function ze(){let{state:e,configData:t,close:n}=v("complete"),{order:o}=e,{sourceSymbol:i,sourceChainName:d,sourceDecimals:l,destSymbol:c,destChainName:u,destDecimals:a}=m.useMemo((()=>{let s=O({address:o.source_currency,caip2:o.source_chain,config:t}),p=O({address:o.destination_currency,caip2:o.destination_chain,config:t});return{sourceSymbol:s.symbol,sourceChainName:z(o.source_chain,t.chains),sourceDecimals:s.decimals,destSymbol:p.symbol,destChainName:z(o.destination_chain,t.chains),destDecimals:p.decimals}}),[o,t]);return r.jsx(Ve,{sourceAmount:o.source_amount,sourceSymbol:i,sourceChainName:d,sourceDecimals:l,destinationAmount:o.destination_amount,destSymbol:c,destChainName:u,destDecimals:a,onClose:n})}function We(){let{modalState:e,setModalState:t,config:n,retryConfig:o,close:i,entrySource:d}=g(),{createAnalyticsEvent:l}=y();if(e.step!=="error")throw Error("UNEXPECTED_STATE");let{code:c}=e,{title:u,subtitle:a,detail:s,iconVariant:p}=(x=>{switch(x){case"AMOUNT_TOO_LOW":return{title:"Amount too low",subtitle:"The deposit amount is below the minimum for this route.",detail:"Try a larger amount or a different token.",iconVariant:"warning"};case"INSUFFICIENT_LIQUIDITY":return{title:"Insufficient liquidity",subtitle:"There isn't enough liquidity for this route right now.",detail:"Try a smaller amount or a different network.",iconVariant:"warning"};case"UNSUPPORTED_CHAIN":return{title:"Unsupported chain",subtitle:"Deposits from this chain type aren't supported yet. Try a different network.",iconVariant:"warning"};case"UNSUPPORTED_CURRENCY":case"UNSUPPORTED_ROUTE":case"ROUTE_UNAVAILABLE":case"NO_SWAP_ROUTES_FOUND":case"NO_INTERNAL_SWAP_ROUTES_FOUND":case"NO_QUOTES":return{title:"Route not available",subtitle:"This deposit route isn't supported right now. Try a different token or network.",iconVariant:"warning"};case"SANCTIONED_WALLET_ADDRESS":return{title:"Address restricted",subtitle:"This address cannot be used for deposits due to compliance restrictions.",iconVariant:"warning"};case"REFUND_WALLET_CREATION_FAILED":return{title:"Unable to set up refund address",subtitle:"We couldn't create a wallet to receive refunds on this chain. Please try again or select a different network.",iconVariant:"warning"};case"DEPOSIT_ADDRESSES_NOT_ENABLED":return{title:"Not enabled",subtitle:"Deposit addresses are not enabled for this app.",iconVariant:"warning"};case"NOT_AUTHENTICATED":return{title:"Not signed in",subtitle:"Please sign in to continue with your deposit.",iconVariant:"warning"};case"TIMEOUT_WAITING_FOR_NEXT_ORDER":case"TIMEOUT_ORDER_COMPLETION":return{title:"Taking longer than expected",subtitle:"Your funds are safe. The deposit is still being processed — check back later.",iconVariant:"subtle"};default:return{title:"Something went wrong",subtitle:"We couldn't complete your request. Please try again.",iconVariant:"subtle"}}})(c),[b,_]=m.useState(!1);return r.jsx(T,{icon:F,iconVariant:p,title:u,subtitle:s?`${a} ${s}`:a,showClose:!0,onClose:i,primaryCta:{label:"Try again",onClick:async()=>{if(l({eventName:"sdk_deposit_address_action",payload:{action:"retry",step:"error",errorCode:c,entrySource:d}}),n.status!=="ready"){_(!0);try{await o(),t({step:"token"})}catch{_(!1)}}else t({step:"token"})},loading:b},watermark:!0})}function qe(){let{state:e,close:t,entrySource:n}=v("failed"),{createAnalyticsEvent:o}=y(),{order:i}=e;return r.jsx(S,{icon:F,iconVariant:"error",title:"Transfer failed",subtitle:"Something went wrong processing your transfer.",showClose:!0,onClose:t,primaryCta:{label:"Done",onClick:t},secondaryCta:{label:"Learn about manual recovery",onClick:()=>{o({eventName:"sdk_deposit_address_action",payload:{action:"link_opened",step:"failed",target:"recovery_docs",entrySource:n}}),window.open("https://docs.privy.io","_blank","noopener,noreferrer")}},watermark:!0,children:r.jsxs(Xe,{href:i.tracking_url,target:"_blank",rel:"noopener noreferrer",onClick:()=>{o({eventName:"sdk_deposit_address_action",payload:{action:"link_opened",step:"failed",target:"relay_reference",entrySource:n}})},children:["Reference: ",i.provider_request_id]})})}let Xe=f.a`
  text-align: center;
  font-size: 0.75rem;
  opacity: 0.7;
  text-decoration: underline;
  cursor: pointer;
  color: var(--privy-color-foreground-3);
`;function Qe(){let{close:e,setModalState:t,config:n,params:o,onBack:i,entrySource:d}=g(),{createAnalyticsEvent:l}=y(),[c,u]=m.useState(!1);m.useEffect((()=>{if(c&&o){if(n.status==="ready"){let s=q(n.data,o);t(s?{step:"error",code:"ROUTE_UNAVAILABLE",message:s}:{step:"token"})}n.status==="error"&&t({step:"error",code:"ROUTE_UNAVAILABLE"})}}),[c,n,o,t]);let a=i?()=>{l({eventName:"sdk_deposit_address_action",payload:{action:"back",step:"intro",entrySource:d}}),i()}:void 0;return r.jsx(T,{icon:J,iconVariant:"subtle",title:"Add funds",subtitle:"Top up your account by sending crypto from any wallet. Conversion and routing handled by Relay.",showClose:!0,onClose:e,showBack:!!i,onBack:a,primaryCta:{label:"Continue",onClick:()=>{if(l({eventName:"sdk_deposit_address_action",payload:{action:"continue",step:"intro",entrySource:d}}),n.status==="ready"&&o){let s=q(n.data,o);t(s?{step:"error",code:"ROUTE_UNAVAILABLE",message:s}:{step:"token"})}else n.status==="error"?t({step:"error",code:"ROUTE_UNAVAILABLE"}):u(!0)},loading:c&&n.status==="loading",loadingText:null},watermark:!0})}function Ye(){let{state:e,setModalState:t,close:n,entrySource:o}=v("network"),{createAnalyticsEvent:i}=y(),[d,l]=m.useState(-1),{availableChains:c}=e,{confirm:u,isFetching:a}=(function(){let s=E(),{params:p}=g(),{fetchQuote:b,isFetching:_}=ee();return{confirm:m.useCallback((async x=>{if(!x||!p)return;let h=s==null?void 0:s.modalState;h&&h.step==="network"&&await b(x,h.selectedCurrency,h.availableChains)}),[p,s,b]),isFetching:_}})();return r.jsx(S,{title:"Select network",eyebrow:r.jsxs("span",{style:{display:"flex",alignItems:"center",gap:"0.375rem"},children:[r.jsx("img",{src:e.selectedCurrency.logoURI,alt:"",style:{width:"1rem",height:"1rem",borderRadius:"50%"}}),"Send ",e.selectedCurrency.symbol]}),showBack:!0,onBack:()=>{i({eventName:"sdk_deposit_address_action",payload:{action:"back",step:"network",entrySource:o}}),t({step:"token"})},showClose:!0,onClose:n,watermark:!0,children:r.jsx(Z,{style:{marginTop:"1rem",height:"22rem"},$colorScheme:"light",children:c.map(((s,p)=>r.jsxs(Q,{$selected:d===p,disabled:a,onClick:()=>{i({eventName:"sdk_deposit_address_action",payload:{action:"network_selected",step:"network",network:s.caip2,entrySource:o}}),l(p),u(s)},children:[r.jsx(Y,{src:s.iconUrl,alt:s.displayName}),r.jsx(H,{children:s.displayName}),a&&p===d&&r.jsx(K,{})]},s.caip2)))})})}const He=({trackingUrl:e,onViewBlockExplorer:t,onClose:n})=>r.jsx(S,{icon:Se,iconVariant:"subtle",title:"Transfer in progress",subtitle:"Your deposit was received and the transfer is now processing.",showClose:!0,onClose:n,secondaryCta:{label:"View on block explorer ↗",onClick:()=>{t(),window.open(e,"_blank","noopener,noreferrer")}},watermark:!1,children:r.jsxs(ue,{children:[r.jsxs(N,{children:[r.jsx(j,{$status:"done",children:r.jsx(P,{size:14,color:"var(--privy-color-icon-success)",strokeWidth:2})}),r.jsx(U,{children:"Deposit received"})]}),r.jsx(M,{}),r.jsxs(N,{children:[r.jsx(j,{$status:"active",children:r.jsx(Ke,{})}),r.jsx(U,{children:"Bridging"})]}),r.jsx(M,{}),r.jsxs(N,{children:[r.jsx(j,{$status:"pending"}),r.jsx(U,{children:"Funds arrived"})]})]})});let Ke=f.span`
  width: 0.75rem;
  height: 0.75rem;
  border: 2px solid var(--privy-color-foreground-3);
  border-bottom-color: transparent;
  border-radius: 50%;
  display: inline-block;
  animation: spin 1s linear infinite;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;function Ge(){let{state:e,close:t,entrySource:n}=v("processing"),{createAnalyticsEvent:o}=y();return(function({orderId:i,enabled:d}){let{privy:l}=y(),{setModalState:c}=g();m.useEffect((()=>{let u=new AbortController;return R.waitForCompletion({privy:l,orderId:i,signal:u.signal}).then((a=>{u.signal.aborted||(a.status==="success"?re(a.order,c):a.status==="timeout"&&c({step:"error",code:"TIMEOUT_ORDER_COMPLETION"}))})),()=>{u.abort()}}),[d,i,l,c])})({orderId:e.order.id,enabled:!0}),r.jsx(He,{trackingUrl:e.order.tracking_url,onViewBlockExplorer:()=>{o({eventName:"sdk_deposit_address_action",payload:{action:"link_opened",step:"processing",target:"block_explorer",entrySource:n}})},onClose:t})}function Je(){let{state:e,close:t,entrySource:n}=v("refunded"),{createAnalyticsEvent:o}=y(),{order:i}=e;return r.jsx(T,{icon:$e,iconVariant:"subtle",title:"Transfer refunded",subtitle:"Your transfer was received, but the swap couldn't be completed. A refund has been started automatically.",showClose:!0,onClose:t,primaryCta:{label:"Done",onClick:t},secondaryCta:{label:"View transaction details",onClick:()=>{o({eventName:"sdk_deposit_address_action",payload:{action:"link_opened",step:"refunded",target:"transaction_details",entrySource:n}}),window.open(i.tracking_url,"_blank","noopener,noreferrer")}},watermark:!0})}function Ze(){let{close:e,setModalState:t,config:n,entrySource:o}=g(),{createAnalyticsEvent:i}=y(),{confirm:d,currencies:l,isFetching:c}=(function(){let{config:s,setModalState:p}=g(),{fetchQuote:b,isFetching:_}=ee(),x=s.status==="ready"?s.data.currencies.filter((h=>W(h,s.data).length>0)):[];return{confirm:m.useCallback((async h=>{if(s.status!=="ready"||!h)return;let C=W(h,s.data);if(C.length!==1)p({step:"network",selectedCurrency:h,availableChains:C});else{let k=C[0];await b(k,h,C)}}),[s,b,p]),currencies:x,isFetching:_}})(),[u,a]=m.useState(-1);return r.jsx(S,{title:"Select token",showBack:!0,onBack:()=>{i({eventName:"sdk_deposit_address_action",payload:{action:"back",step:"token",entrySource:o}}),t({step:"intro"})},showClose:!0,onClose:e,watermark:!0,children:n.status==="error"?r.jsx(L,{children:r.jsx(ce,{children:"Failed to load tokens"})}):n.status==="loading"?r.jsx(L,{children:r.jsx(se,{})}):r.jsx(Z,{style:{marginTop:"1rem",height:"22rem"},$colorScheme:"light",children:l.map(((s,p)=>r.jsxs(Q,{$selected:u===p,disabled:c,onClick:()=>{i({eventName:"sdk_deposit_address_action",payload:{action:"token_selected",step:"token",token:s.symbol,entrySource:o}}),a(p),d(s)},children:[r.jsx(G,{src:s.logoURI,alt:s.symbol}),r.jsx(H,{children:s.name}),c&&p===u?r.jsx(K,{}):r.jsx(de,{children:s.symbol})]},s.symbol)))})})}function er({address:e,onClick:t}){let[n,o]=m.useState(!1);return r.jsx(r.Fragment,{children:n?r.jsx(rr,{onClick:()=>o(!1),style:{marginTop:"1.5rem"},children:r.jsx(me,{url:e,size:312,hideLogo:!0})}):r.jsxs(tr,{title:"Click to copy address",onClick:t,style:{marginTop:"1.5rem"},children:[r.jsxs(nr,{children:[r.jsx(or,{children:"Deposit address"}),r.jsx(sr,{children:e})]}),r.jsx(ar,{children:r.jsx(ir,{type:"button",onClick:i=>{i.stopPropagation(),o(!0)},children:r.jsx(J,{size:16,color:"var(--privy-color-icon-muted)"})})})]})})}let rr=f.div`
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  overflow: hidden;
`,tr=f.div`
  display: flex;
  border-radius: var(--privy-border-radius-md);
  background: var(--privy-color-background-clicked, #f1f2f9);
  padding: 1rem;
  cursor: pointer;
  gap: 0.5rem;
`,nr=f.div`
  flex: 1;
  min-width: 0;
  text-align: left;
`,or=f.div`
  font-size: 0.75rem;
  color: var(--privy-color-icon-muted);
  line-height: 1rem;
  margin-bottom: 0.25rem;
`,sr=f.div`
  word-break: break-all;
  font-size: 0.875rem;
  font-family: ui-monospace, monospace;
  font-weight: 500;
  line-height: 1.375rem;
  color: var(--privy-color-foreground);
`,ar=f.div`
  width: 1.5rem;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  padding-top: 0.25rem;
`,ir=f.button`
  && {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border: none;
    background: transparent;
    cursor: pointer;
    outline: none;
    box-shadow: none;
    border-radius: var(--privy-border-radius-xs);

    &:hover {
      background: var(--privy-color-background);
    }

    &:focus,
    &:focus-visible {
      outline: none;
      box-shadow: none;
    }
  }
`;function lr({quote:e,selectedCurrency:t,selectedChain:n,destinationSymbol:o}){let[i,d]=m.useState(!1),l=t.symbol.toUpperCase(),c=n.displayName,u=m.useRef(null);return r.jsxs(cr,{children:[r.jsxs(dr,{onClick:m.useCallback((()=>{let a=document.getElementById("privy-modal-content");a&&(u.current&&clearTimeout(u.current),a.style.transition="none",u.current=setTimeout((()=>{a.style.transition="",u.current=null}),160)),d((s=>!s))}),[]),children:[r.jsxs(ur,{children:[t.logoURI&&r.jsx(G,{src:t.logoURI,alt:l,style:{width:"2rem",height:"2rem"}}),n.iconUrl&&r.jsx(pr,{src:n.iconUrl,alt:c})]}),r.jsxs(mr,{children:[r.jsx(fr,{children:"You send"}),r.jsxs(hr,{children:[l," on ",c]})]}),r.jsx(yr,{children:r.jsx(i?Ie:we,{size:16})})]}),r.jsx(xr,{$expanded:i,children:r.jsx(Cr,{children:r.jsxs(gr,{children:[e.indicative_rate&&r.jsxs(A,{children:[r.jsx(D,{children:"Conversion rate"}),r.jsxs(I,{style:{display:"flex",alignItems:"center",gap:"0.25rem"},children:[Le(e.indicative_rate,l,o.toUpperCase()),r.jsx(Er,{content:"Estimated rate based on current market conditions. Final execution price may vary depending on transfer size and routing."})]})]}),r.jsxs(A,{children:[r.jsx(D,{children:"Max slippage"}),r.jsxs(I,{children:[(e.slippage_bps/100).toFixed(1),"%"]})]}),r.jsxs(A,{children:[r.jsx(D,{children:"Refund address"}),r.jsx(I,{children:r.jsx(ke,{value:e.refund_address,iconOnly:!0,iconSize:11,children:le(e.refund_address,4,4)})})]})]})})}),r.jsxs(br,{children:[r.jsx(F,{size:16,color:"var(--privy-color-icon-muted)",style:{flexShrink:0}}),r.jsxs(_r,{children:["Only send ",r.jsx("strong",{children:l})," on ",r.jsx("strong",{children:c}),". Other assets may be lost."]})]})]})}let cr=f.div`
  border-radius: var(--privy-border-radius-md);
  border: 1px solid var(--privy-color-foreground-4);
  overflow: hidden;
`,dr=f.button`
  && {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--privy-color-foreground);
    outline: none;
    box-shadow: none;

    &:focus,
    &:focus-visible {
      outline: none;
      box-shadow: none;
    }
  }
`,ur=f.span`
  position: relative;
  width: 2rem;
  height: 2rem;
  flex-shrink: 0;
`,pr=f(Y)`
  && {
    position: absolute;
    top: -0.125rem;
    right: -0.25rem;
    width: 0.75rem;
    height: 0.75rem;
    box-sizing: content-box;
    border: 1.5px solid #fff;
    background-color: #fff;
  }
`,mr=f.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
`,fr=f.span`
  font-size: 0.75rem;
  color: var(--privy-color-foreground-3);
  line-height: 1rem;
`,hr=f.span`
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25rem;
`,yr=f.span`
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: var(--privy-border-radius-full);
  background-color: var(--privy-color-background-clicked, #f1f2f9);
  color: var(--privy-color-foreground-3);
`,gr=f.div`
  display: flex;
  flex-direction: column;
  padding: 0 1rem 0.75rem;

  & > * {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--privy-color-foreground-4);
  }

  & > *:last-child {
    border-bottom: none;
  }
`,br=f.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0.75rem 0.75rem;
  padding: 0.625rem 0.75rem;
  border-radius: var(--privy-border-radius-sm);
  background: #f8f9fc;
`,_r=f.span`
  font-size: 0.8125rem;
  line-height: 1.25rem;
  color: var(--privy-color-icon-muted);
  text-align: left;
`,xr=f.div`
  display: grid;
  grid-template-rows: ${({$expanded:e})=>e?"1fr":"0fr"};
  transition: grid-template-rows 150ms ease-out;
`,Cr=f.div`
  overflow: hidden;
`;function Er({content:e}){let[t,n]=m.useState(!1),{refs:o,floatingStyles:i,context:d}=fe({open:t,onOpenChange:n,placement:"top",whileElementsMounted:Te,middleware:[Ne(6),je(),Ue({padding:8})]}),l=he(d,{move:!1,handleClose:ye()}),c=ge(d),{getReferenceProps:u,getFloatingProps:a}=be([l,c,_e(d),xe(d),Ce(d,{role:"tooltip"})]),{isMounted:s,styles:p}=Ee(d,{duration:150});return r.jsxs(r.Fragment,{children:[r.jsx("button",{ref:o.setReference,type:"button","aria-label":"More information about conversion rate",style:{display:"inline-flex",alignItems:"center",justifyContent:"center",padding:0,border:"none",background:"none",color:"var(--privy-color-icon-muted)",cursor:"pointer"},...u(),children:r.jsx(Re,{size:14})}),s&&r.jsx(ve,{root:document.getElementById("privy-modal-content")??void 0,children:r.jsx(vr,{ref:o.setFloating,style:{...i,...p},...a(),children:e})})]})}let vr=f.div`
  max-width: 13rem;
  padding: 0.5rem 0.625rem;
  border-radius: var(--privy-border-radius-sm, 0.375rem);
  background: var(--privy-color-foreground);
  color: var(--privy-color-background);
  font-size: 0.6875rem;
  line-height: 1rem;
  font-weight: 400;
  text-align: left;
  z-index: 10;
`;const kr=({quote:e,selectedCurrency:t,selectedChain:n,destinationSymbol:o,onBack:i,onClose:d})=>{var p;let[l,c]=m.useState(!1),u=((p=t==null?void 0:t.symbol)==null?void 0:p.toUpperCase())??"funds",a=(n==null?void 0:n.displayName)??"",s=async()=>{l||(await navigator.clipboard.writeText(e.deposit_address),c(!0),setTimeout((()=>c(!1)),2e3))};return r.jsxs(S,{title:`Send ${u}${a?` on ${a}`:""}`,subtitle:"Send funds to the address below. Conversion and routing handled by Relay.",showBack:!0,onBack:i,showClose:!0,onClose:d,watermark:!1,children:[r.jsx(lr,{quote:e,selectedCurrency:t,selectedChain:n,destinationSymbol:o}),r.jsx(er,{address:e.deposit_address,onClick:s}),r.jsx(pe,{style:{marginTop:"1rem",marginBottom:"0.5rem",...l?{backgroundColor:"var(--privy-color-icon-success)",borderColor:"var(--privy-color-icon-success)"}:{}},onClick:s,children:l?r.jsxs(r.Fragment,{children:["Copied ",r.jsx(P,{size:16,style:{marginLeft:"0.25rem"}})]}):"Copy address"}),r.jsx(Sr,{children:"Routing and bridging are handled by Relay. Privy does not control execution timing, liquidity, or transaction outcomes."})]})};let Sr=f.p`
  && {
    margin: 0.5rem 0 0;
    font-size: 0.6875rem;
    line-height: 1.125rem;
    color: var(--privy-color-icon-muted);
    text-align: center;
  }
`;function wr(){let{state:e,configData:t,setModalState:n,close:o,params:i,entrySource:d}=v("address"),{createAnalyticsEvent:l}=y(),{quote:c,selectedCurrency:u,selectedChain:a,availableChains:s}=e;return(function({depositAddressId:p,enabled:b,quoteCreatedAt:_}){let{privy:x}=y(),{setModalState:h}=g();m.useEffect((()=>{if(!p)return;let C=new AbortController;return R.waitForDeposit({privy:x,depositAddressId:p,quoteCreatedAt:_,signal:C.signal}).then((k=>{C.signal.aborted||(k.status==="success"?re(k.order,h):k.status==="timeout"&&h({step:"error",code:"TIMEOUT_WAITING_FOR_NEXT_ORDER"}))})),()=>{C.abort()}}),[b,p,x,_,h])})({depositAddressId:c.id,enabled:!0,quoteCreatedAt:c.created_at}),r.jsx(kr,{quote:c,selectedCurrency:u,selectedChain:a,destinationSymbol:m.useMemo((()=>O({address:i.destinationCurrency,caip2:i.destinationChain,config:t}).symbol),[i,t]),onBack:()=>{l({eventName:"sdk_deposit_address_action",payload:{action:"back",step:"address",entrySource:d}}),n({step:"network",selectedCurrency:u,availableChains:s})},onClose:o})}function Tr(){let{modalState:e,setModalState:t}=g();return r.jsx(Pe,{onError:n=>t({step:"error",code:"UNEXPECTED_STATE",message:n.message}),resetKey:e.step,children:r.jsx(Nr,{})})}function Nr(){let{modalState:e}=g();switch(e.step){case"intro":return r.jsx(Qe,{});case"token":return r.jsx(Ze,{});case"network":return r.jsx(Ye,{});case"address":return r.jsx(wr,{});case"processing":return r.jsx(Ge,{});case"complete":return r.jsx(ze,{});case"refunded":return r.jsx(Je,{});case"failed":return r.jsx(qe,{});case"error":return r.jsx(We,{});default:return null}}var Qr={component:()=>{let{onUserCloseViaDialogOrKeybindRef:e}=oe(),t=E(),{close:n,config:o}=g();return m.useEffect((()=>{e.current=n}),[e,n]),m.useEffect((()=>{if(o.status==="ready"){for(let i of o.data.currencies)new Image().src=i.logoURI;for(let i of Object.values(o.data.chains))new Image().src=i.iconUrl}}),[o]),t?r.jsx(Tr,{}):null}};export{Qr as default};
