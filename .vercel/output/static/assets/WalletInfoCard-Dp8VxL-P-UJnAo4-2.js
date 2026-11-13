import{db as d,d8 as e,dB as r}from"./index-DhRHqroX.js";import{$ as p}from"./ModalHeader-CPVs-20G-DQnBeNVR.js";import{e as f}from"./ErrorMessage-D8VaAP5m-ByzF5ihe.js";import{r as x}from"./LabelXs-oqZNqbm_-D83khnQC.js";import{d as h}from"./Address-D7Y56HDo-CbomqQrQ.js";import{d as g}from"./shared-FM0rljBt-Dln_yI2J.js";import{C as j}from"./check-CFrq-bW0.js";import{C as u}from"./copy-DcynFTrr.js";let v=r(g)`
  && {
    padding: 0.75rem;
    height: 56px;
  }
`,y=r.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
`,C=r.div`
  display: flex;
  flex-direction: column;
  gap: 0;
`,b=r.div`
  font-size: 12px;
  line-height: 1rem;
  color: var(--privy-color-foreground-3);
`,w=r(x)`
  text-align: left;
  margin-bottom: 0.5rem;
`,z=r(f)`
  margin-top: 0.25rem;
`,E=r(p)`
  && {
    gap: 0.375rem;
    font-size: 14px;
  }
`;const P=({errMsg:t,balance:i,address:a,className:c,title:n,showCopyButton:m=!1})=>{let[o,l]=d.useState(!1);return d.useEffect((()=>{if(o){let s=setTimeout((()=>l(!1)),3e3);return()=>clearTimeout(s)}}),[o]),e.jsxs("div",{children:[n&&e.jsx(w,{children:n}),e.jsx(v,{className:c,$state:t?"error":void 0,children:e.jsxs(y,{children:[e.jsxs(C,{children:[e.jsx(h,{address:a,showCopyIcon:!1}),i!==void 0&&e.jsx(b,{children:i})]}),m&&e.jsx(E,{onClick:function(s){s.stopPropagation(),navigator.clipboard.writeText(a).then((()=>l(!0))).catch(console.error)},size:"sm",children:e.jsxs(e.Fragment,o?{children:["Copied",e.jsx(j,{size:14})]}:{children:["Copy",e.jsx(u,{size:14})]})})]})}),t&&e.jsx(z,{children:t})]})};export{P as j};
