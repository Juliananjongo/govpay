import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { sandboxMode, supabase, supabaseConfigurationError } from "./supabase";

type Portal = "public" | "citizen" | "admin" | "bank";
type Page = { portal: Portal; view: string };
type Service = { id?:string; name:string; category:string; fee:string; feeMinorUnits?:number; currency?:string; time:string; description:string };
type ApplicationRecord = {
  id?:string;
  invoiceId?:string;
  invoiceReference?:string;
  paymentReference?:string;
  providerTransactionId?:string;
  reference: string;
  service: Service;
  applicant: string;
  email: string;
  date: string;
  status: string;
};
type AuthFormValues = {
  email: string;
  password: string;
  fullName?: string;
  accountType?: "citizen" | "business";
  businessName?: string;
  registrationNumber?: string;
  phone?: string;
};
type ApplicationFormValues = {
  applicantName:string;
  applicantEmail:string;
  applicantPhone:string;
  details:{applicantType:string;requestName:string;category:string;supportingInformation:string;mobileMoneyNetwork:string};
};

const services:Service[] = [
  { name: "Business Registration", category: "Business", fee: "K 500.00", time: "3–5 business days", description: "Register a new business through the GovPay platform." },
  { name: "Business Permit", category: "Licensing", fee: "K 350.00", time: "2–4 business days", description: "Apply for a sandbox annual business operating permit." },
  { name: "License Application", category: "Licensing", fee: "K 250.00", time: "5–7 business days", description: "Submit and track a general sandbox license application." },
  { name: "Certificate Request", category: "Documents", fee: "K 120.00", time: "1–2 business days", description: "Request a certified document from the sandbox registry." },
  { name: "Document Request", category: "Documents", fee: "K 80.00", time: "1–2 business days", description: "Request a copy of a sample public record." },
];

const citizenNav = ["Dashboard", "Services", "Applications", "Invoices", "Payments", "Receipts", "Profile"];
const adminNav = ["Dashboard", "Applications", "Services", "Payments", "Reconciliation", "Reports", "Users", "Audit Logs"];
const iconPaths: Record<string, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></>,
  wallet: <><path d="M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v12H5a3 3 0 0 1-3-3V6"/><path d="M16 15h.01"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4 22a8 8 0 0 1 16 0"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
  building: <><path d="M3 21h18M6 21V9h12v12M9 9V5l3-2 3 2v4M9 13h.01M15 13h.01M9 17h.01M15 17h.01"/></>,
  trend: <><path d="m3 17 6-6 4 4 8-9"/><path d="M15 6h6v6"/></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
  download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 21h16"/></>,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></>,
};

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name] || iconPaths.file}</svg>;
}

function Logo({ inverse = false }: { inverse?: boolean }) {
  return <div className={`logo ${inverse ? "logo-inverse" : ""}`}>
    <span className="logo-mark"><i /><b /></span>
    <span>GovPay</span>
  </div>;
}

function Button({ children, variant = "primary", icon, onClick, type = "button" }: { children: ReactNode; variant?: "primary" | "secondary" | "text" | "danger"; icon?: string; onClick?: () => void; type?: "button" | "submit" }) {
  return <button className={`btn btn-${variant}`} onClick={onClick} type={type}>{children}{icon && <Icon name={icon} size={17} />}</button>;
}

function Badge({ children, tone = "pending" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}><i />{children}</span>;
}

function SandboxNotice() {
  if (!sandboxMode) return null;
  return <div className="sandbox-banner"><Icon name="shield" size={15} /> Sandbox environment only — no real government or payment services are connected</div>;
}

function Field({ label, placeholder, type = "text", name, required = false }: { label: string; placeholder?: string; type?: string; name?: string; required?: boolean }) {
  return <label className="field"><span>{label}</span><input name={name} type={type} placeholder={placeholder || label} required={required} /></label>;
}

function SelectField({ label, options = ["Select an option"], name, required = false }: { label: string; options?: string[]; name?: string; required?: boolean }) {
  return <label className="field"><span>{label}</span><select name={name} required={required}>{options.map((x, i) => <option key={x} value={i === 0 && x.startsWith("Select ") ? "" : x}>{x}</option>)}</select></label>;
}

function StatCard({ label, value, note, icon = "trend", accent = false }: { label: string; value: string; note?: string; icon?: string; accent?: boolean }) {
  return <article className={`stat-card ${accent ? "accent" : ""}`}>
    <div className="stat-top"><span>{label}</span><i className="icon-box"><Icon name={icon} size={19} /></i></div>
    <strong>{value}</strong>{note && <small>{note}</small>}
  </article>;
}

function Status({ value }: { value: string }) {
  const v = value.toLowerCase();
  const tone = v.includes("paid") || v.includes("successful") || v.includes("completed") || v.includes("approved") || v.includes("matched") ? "success" : v.includes("reject") || v.includes("failed") || v === "unmatched" ? "danger" : v.includes("review") ? "info" : "pending";
  return <Badge tone={tone}>{value}</Badge>;
}

function DataTable({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  return <div className="table-wrap"><table><thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}

function PublicHeader({ go }: { go: (view: string) => void }) {
  return <header className="public-header"><Logo /><nav><button onClick={() => go("services")}>Services</button><button onClick={() => go("about")}>How it works</button><button onClick={() => go("login")}>Help</button></nav><div className="header-actions"><Button variant="text" onClick={() => go("login")}>Sign in</Button><Button onClick={() => go("register")}>Create account</Button></div><button className="mobile-menu" onClick={() => go("login")} aria-label="Open menu"><Icon name="menu" /></button></header>;
}

function Landing({ go, apply, services }: { go: (view: string) => void; apply: (service: Service) => void; services:Service[] }) {
  return <div className="public-page"><SandboxNotice/><PublicHeader go={go}/>
    <main>
      <section className="hero">
        <div className="hero-copy"><span className="eyebrow">PUBLIC SERVICES, MADE SIMPLE</span><h1>Government services.<br/><em>Simple payments.</em></h1><p>{sandboxMode?"Explore sample services, submit a sandbox application, and follow a simulated payment journey. No real service or payment is connected.":"Browse available services, submit an application, and follow its payment status in one place."}</p><div className="button-row"><Button onClick={() => go("register")} icon="arrow">Get started</Button><Button variant="secondary" onClick={() => go("services")}>Explore services</Button></div><div className="trust-row"><Icon name="shield" size={18}/><span>{sandboxMode?"Sandbox environment":"Application status tracking"}</span><i/><span>Transparent tracking</span></div></div>
        <div className="hero-visual" aria-label="Abstract GovPay transaction illustration">
          <div className="sun-dot"/><div className="visual-card main-card"><span className="mini-label">APPLICATION OVERVIEW</span><div className="card-title"><i className="icon-box"><Icon name="building"/></i><div><b>{sandboxMode?"Business Registration":"Your service application"}</b><span>{sandboxMode?"APP-2026-00124":"Application reference"}</span></div></div><div className="progress-line"><i/></div><div className="visual-meta"><span>{sandboxMode?"Sample application":"Application status"}</span><Status value="Payment required"/></div></div>
          {sandboxMode&&<div className="visual-card receipt-mini"><span><Icon name="check" size={18}/></span><div><small>Simulated payment received</small><b>K 500.00</b></div></div>}
          <div className="mustard-shape"/>
        </div>
      </section>
      <section className="section"><div className="section-title"><span className="eyebrow">ONE TRUSTED PLACE</span><h2>Everything you need in one place</h2><p>A clear path from finding a service to receiving your final receipt.</p></div><div className="feature-grid">
        {[["building","Government Services",sandboxMode?"Browse sample services and review their displayed requirements.":"Browse currently available services and their requirements."],["wallet","Simple Payments",sandboxMode?"Follow a simulated payment journey without moving money.":"Authorize Zambia mobile-money payments through Flutterwave."],["file","Track Applications",sandboxMode?"Explore the sandbox application and receipt screens.":"Review the status of your submitted application."]].map((x,i)=><article className="feature-card" key={String(x[1])}><span className="feature-num">0{i+1}</span><i className="feature-icon"><Icon name={String(x[0])}/></i><h3>{x[1]}</h3><p>{x[2]}</p></article>)}
      </div></section>
      <section className="works"><div className="section-title left"><span className="eyebrow">HOW GOVPAY WORKS</span><h2>Four steps. One clear journey.</h2></div><div className="steps">{["Choose a Service","Submit Your Application","Make Your Payment","Receive Your Receipt"].map((x,i)=><div className="step" key={x}><span>0{i+1}</span><i/><h3>{x}</h3><p>{(sandboxMode?["Browse sample services and displayed fees.","Complete the sandbox application form.","Explore a simulated payment flow.","View a sample printable record."]:["Browse available services and fees.","Submit an application securely.","Authorize your mobile-money payment.","Review your application and payment status."])[i]}</p></div>)}</div></section>
      <section className="section services-preview"><div className="section-title split"><div><span className="eyebrow">POPULAR SERVICES</span><h2>Start with a service</h2></div><Button variant="secondary" onClick={()=>go("services")} icon="arrow">View all services</Button></div><div className="service-grid">{services.slice(0,3).map(s=><ServiceCard service={s} onApply={()=>apply(s)} key={s.name}/>)}</div></section>
      <section className="cta-band"><div><span className="eyebrow">READY WHEN YOU ARE</span><h2>A simpler way to get things done.</h2><p>Access your account to manage public-service applications and payments.</p></div><Button variant="secondary" onClick={()=>go("register")} icon="arrow">Create your account</Button></section>
    </main><Footer go={go}/></div>;
}

function Footer({ go }: { go:(v:string)=>void }) {
  return <footer><div><Logo inverse/><p>Government Services. Simple Payments.</p><small>{sandboxMode&&<>SANDBOX / SAMPLE DATA<br/></>}No affiliation with any government, bank, or payment provider.</small></div><div className="footer-links">{["Services","Help","About","Privacy","Terms"].map(x=><button key={x} onClick={()=>go(x.toLowerCase())}>{x}</button>)}</div><span>© 2026 GovPay</span></footer>;
}

function ServiceCard({ service, onApply }: { service: typeof services[0]; onApply:()=>void }) {
  return <article className="service-card"><div className="service-card-top"><i className="icon-box"><Icon name={service.category === "Documents" ? "file":"building"}/></i><Badge tone="neutral">{service.category}</Badge></div><h3>{service.name}</h3><p>{service.description}</p><div className="service-facts"><span><small>FEE</small><b>{service.fee}</b></span><span><small>PROCESSING</small><b>{service.time}</b></span></div><Button variant="secondary" onClick={onApply} icon="arrow">Apply now</Button></article>;
}

function ServicesPage({ go, apply, services }: { go:(v:string)=>void; apply:(service:Service)=>void; services:Service[] }) {
  const [filter,setFilter]=useState("All"); const [query,setQuery]=useState("");
  const shown=services.filter(s=>(filter==="All"||s.category===filter)&&s.name.toLowerCase().includes(query.toLowerCase()));
  return <div className="public-page inner-public"><SandboxNotice/><PublicHeader go={go}/><main className="public-inner"><PageHeader title="Government Services" subtitle="Choose a sandbox service and start your application."/><div className="search-filter"><label className="search-box"><Icon name="search"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search services..."/></label><div className="pills">{["All","Business","Licensing","Documents"].map(x=><button className={filter===x?"active":""} onClick={()=>setFilter(x)} key={x}>{x}</button>)}</div></div><div className="service-grid">{shown.map(s=><ServiceCard key={s.name} service={s} onApply={()=>apply(s)}/>)}</div></main><Footer go={go}/></div>;
}

function Auth({ mode, go, enter, authenticate, sandbox }: {
  mode:"login"|"register";
  go:(v:string)=>void;
  enter:(p:Portal)=>void;
  authenticate:(mode:"login"|"register", values:AuthFormValues)=>Promise<string|void>;
  sandbox:boolean;
}) {
  const [business,setBusiness]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [submitting,setSubmitting]=useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (mode === "register" && form.get("password") !== form.get("confirmPassword")) {
      setError("Passwords do not match. Please check and try again.");
      return;
    }
    setError("");
    setMessage("");
    setSubmitting(true);
    try {
      const values:AuthFormValues={
        email:String(form.get("email")),
        password:String(form.get("password")),
        fullName:form.get("fullName") ? String(form.get("fullName")) : undefined,
        accountType:business?"business":"citizen",
        businessName:form.get("businessName") ? String(form.get("businessName")) : undefined,
        registrationNumber:form.get("registrationNumber") ? String(form.get("registrationNumber")) : undefined,
        phone:form.get("phone") ? String(form.get("phone")) : undefined,
      };
      if (sandbox) {
        enter("citizen");
      } else {
        const result=await authenticate(mode,values);
        if(result) setMessage(result);
      }
    } catch (authenticationError) {
      setError(authenticationError instanceof Error?authenticationError.message:"Unable to authenticate. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }
  return <div className="auth-page"><SandboxNotice/><button className="auth-logo" onClick={()=>go("landing")}><Logo/></button><div className="auth-shell"><div className="auth-aside"><span className="eyebrow">GOVPAY SANDBOX</span><h1>{mode==="login"?"Welcome back.":"A clearer way to manage public services."}</h1><p>{mode==="login"?"Sign in to the sandbox workspace.":"Access applications, payments, and receipts."}</p><div className="quote-card"><Icon name="shield"/><span>This is a sandbox experience. No real applications or payments are submitted.</span></div></div>
    <form className="auth-card" onSubmit={submit}><h2>{mode==="login"?"Sign in to GovPay":"Create your GovPay account"}</h2><p>{mode==="login"?"Sign in to the browser-only sandbox workspace.":"Already registered? "}{mode==="register"&&<button type="button" className="inline-link" onClick={()=>go("login")}>Sign in</button>}</p>
      {mode==="register"&&<><span className="field-label">Account type</span><div className="segmented"><button type="button" className={!business?"active":""} onClick={()=>setBusiness(false)}>Citizen</button><button type="button" className={business?"active":""} onClick={()=>setBusiness(true)}>Business</button></div><Field label="Full name" name="fullName" placeholder="Alex Example" required/></>}
      {business&&mode==="register"&&<div className="field-grid"><Field label="Business name" name="businessName" required/><Field label="Registration number" name="registrationNumber" required/></div>}
      <Field label="Email address" name="email" type="email" placeholder="alex@example.com" required/>{mode==="register"&&<Field label="Phone number" name="phone" placeholder="+260 000 000 000" required/>}<Field label="Password" name="password" type="password" placeholder="Enter your password" required/>{mode==="register"&&<Field label="Confirm password" name="confirmPassword" type="password" required/>}
      {mode==="login"&&<div className="form-between"><label className="check-label"><input type="checkbox"/>Remember me</label><button type="button" className="inline-link">Forgot password?</button></div>}
      <Button type="submit" icon="arrow">{submitting?"Please wait…":mode==="login"?"Sign in":"Create account"}</Button>
      {error&&<p className="form-error" role="alert">{error}</p>}
      {message&&<p className="form-success" role="status">{message}</p>}
      {!sandbox&&supabaseConfigurationError&&<p className="form-error" role="alert">{supabaseConfigurationError}</p>}
      {mode==="login"&&<><div className="or"><span/>or<span/></div><Button variant="secondary" onClick={()=>go("register")}>Create an account</Button>{sandbox&&<button type="button" className="admin-entry" onClick={()=>enter("admin")}>Government staff sandbox sign in →</button>}</>}
    </form></div><small className="auth-note">Sandbox / sample system — not affiliated with any government or financial institution.</small></div>;
}

function Sidebar({ portal, view, navigate, close }: { portal:"citizen"|"admin"; view:string; navigate:(v:string)=>void; close:()=>void }) {
  const items=portal==="citizen"?citizenNav:adminNav;
  return <aside className="sidebar"><div className="sidebar-brand"><Logo/><button onClick={close}>×</button></div>{portal==="admin"&&<div className="env-badge">SANDBOX ENVIRONMENT</div>}<nav>{items.map((x,i)=><button key={x} className={view===x.toLowerCase().replace(" ","-")?"active":""} onClick={()=>navigate(x.toLowerCase().replace(" ","-"))}><Icon name={["grid","file","building","wallet","trend","file","user","shield"][i%8]} size={19}/>{x}</button>)}</nav><div className="sidebar-bottom"><button><Icon name="shield" size={19}/>Help & support</button><button onClick={()=>navigate("logout")}><Icon name="arrow" size={19}/>Log out</button></div></aside>;
}

function PortalShell({ portal, view, navigate, exit, children }: { portal:"citizen"|"admin"; view:string; navigate:(v:string)=>void; exit:()=>void; children:ReactNode }) {
  const [open,setOpen]=useState(false);
  return <div className={`portal ${open?"nav-open":""}`}><div className="mobile-overlay" onClick={()=>setOpen(false)}/><Sidebar portal={portal} view={view} navigate={v=>{v==="logout"?exit():navigate(v);setOpen(false)}} close={()=>setOpen(false)}/><div className="portal-body"><header className="topbar"><button className="mobile-menu" onClick={()=>setOpen(true)}><Icon name="menu"/></button><div><small>{portal==="admin"?"GOVERNMENT ADMINISTRATION":"GOOD MORNING"}</small><b>{portal==="admin"?"Operations workspace":"Alex Example"}</b></div><label className="top-search"><Icon name="search" size={18}/><input placeholder="Search"/></label><button className="top-icon"><Icon name="bell"/></button><button className="avatar">AE</button></header><div className="mobile-bottom">{(portal==="citizen"?citizenNav.slice(0,4):adminNav.slice(0,4)).map((x,i)=><button className={view===x.toLowerCase()?"active":""} onClick={()=>navigate(x.toLowerCase())} key={x}><Icon name={["grid","building","file","wallet"][i]}/><small>{x}</small></button>)}</div><main className="portal-content">{children}</main></div></div>;
}

const applications = [
  ["APP-2026-00124","Business Registration","06 Oct 2026","Payment Required"],
  ["APP-2026-00102","Certificate Request","28 Sep 2026","Under Review"],
  ["APP-2026-00089","Business Permit","14 Sep 2026","Completed"],
];
const initialApplication: ApplicationRecord = {
  reference: "APP-2026-00124",
  service: services[0],
  applicant: "Alex Example",
  email: "alex@example.com",
  date: "06 Oct 2026",
  status: "Payment Required",
};
const emptyApplication:ApplicationRecord={
  reference:"",
  service:{name:"Select a service",category:"",fee:"K 0.00",time:"",description:""},
  applicant:"",
  email:"",
  date:"",
  status:"",
};
const payments = [
  ["PAY-2026-000124","Business Registration","K 500.00","06 Oct 2026","Successful"],
  ["PAY-2026-000102","Certificate Request","K 120.00","28 Sep 2026","Pending"],
  ["PAY-2026-000089","Business Permit","K 350.00","14 Sep 2026","Successful"],
];

function CitizenDashboard({ nav, application, paid, sandbox }:{nav:(v:string)=>void;application:ApplicationRecord;paid:boolean;sandbox:boolean}) {
  if(!sandbox) return <><PageHeader title="Account overview" subtitle="Manage your service applications and payments." action={<Button onClick={()=>nav("services")} icon="arrow">Browse services</Button>}/><section className="panel"><PanelTitle title="Recent application" action={()=>nav("applications")}/>{application.id?<ApplicationTable nav={nav} application={application} sandbox={false}/>:<p>No applications have been submitted yet.</p>}</section><section className="panel"><PanelTitle title="Recent payments" action={()=>nav("payments")}/>{application.paymentReference?<PaymentTable application={application} paid={paid} sandbox={false}/>:<p>No payments yet.</p>}</section></>;
  return <><PageHeader title={`Welcome back, ${application.applicant.split(" ")[0]}.`} subtitle="Here’s what’s happening with your applications and payments." action={<Button onClick={()=>nav("apply")} icon="arrow">New application</Button>}/><div className="stats-grid"><StatCard label="Active Applications" value="3" icon="file" note="+1 this month"/><StatCard label="Pending Payments" value={paid?"0":"1"} icon="wallet" note={paid?"No payments due":`${application.service.fee} due`}/><StatCard label="Completed" value={paid?"9":"8"} icon="check" note="Across 5 services"/><StatCard label="Total Paid" value={paid?application.service.fee:"K 4,250.00"} icon="trend" accent/></div><div className="content-grid"><section className="panel wide"><PanelTitle title="Recent applications" action={()=>nav("applications")}/><ApplicationTable nav={nav} application={application} paid={paid}/></section><section className="panel quick-panel"><h2>Quick actions</h2><p>What would you like to do?</p>{[["building","Apply for a service","Browse available services","services"],["file","View applications","Check your progress","applications"],["wallet","Make a payment","Pay an outstanding invoice","invoices"]].map(x=><button key={x[1]} onClick={()=>nav(x[3])}><i className="icon-box"><Icon name={x[0]}/></i><span><b>{x[1]}</b><small>{x[2]}</small></span><Icon name="arrow" size={18}/></button>)}</section></div><section className="panel"><PanelTitle title="Recent payments" action={()=>nav("payments")}/><PaymentTable application={application} paid={paid}/></section></>;
}

function PanelTitle({title,action}:{title:string;action?:()=>void}) { return <div className="panel-title"><h2>{title}</h2>{action&&<button onClick={action}>View all <Icon name="arrow" size={16}/></button>}</div> }
function ApplicationTable({nav,application,paid=false,sandbox=true}:{nav:(v:string)=>void;application:ApplicationRecord;paid?:boolean;sandbox?:boolean}) {
 const rows = [...(application.id||sandbox?[[application.reference,application.service.name,application.date,paid?"Completed":application.status]]:[]),...(sandbox?applications.filter(r=>r[0]!==application.reference):[])];
 return <DataTable columns={["Application","Service","Date","Status",""]} rows={rows.map(r=>[<b>{r[0]}</b>,r[1],r[2],<Status value={r[3]}/>,<button className="table-action" onClick={()=>nav("application-detail")}>View</button>])}/>;
}
function PaymentTable({application,paid,sandbox=true}:{application?:ApplicationRecord;paid?:boolean;sandbox?:boolean}) {
 const currentPayment=application?.paymentReference
  ? [[application.paymentReference,application.service.name,application.service.fee,application.date,paid?"Successful":"Pending"]]
  : application&&sandbox
   ? [[application.reference.replace("APP","PAY"),application.service.name,application.service.fee,application.date,paid?"Successful":"Pending"]]
   : [];
 const rows = [...currentPayment,...(sandbox?payments.filter(r=>r[0]!==application?.paymentReference&&r[0]!==application?.reference.replace("APP","PAY")):[])];
 return <DataTable columns={["Payment reference","Service","Amount","Date","Status"]} rows={rows.map(r=>[<b>{r[0]}</b>,r[1],r[2],r[3],<Status value={r[4]}/>])}/>;
}

function FilterBar({search="Search records..."}:{search?:string}) { return <div className="filterbar"><label className="search-box"><Icon name="search" size={18}/><input placeholder={search}/></label><SelectField label="" options={["All statuses","Successful","Pending","Failed"]}/><SelectField label="" options={["Newest first","Oldest first"]}/></div> }
function Pagination(){return <div className="pagination"><span>Showing 1–3 of 24</span><div><button>‹</button><button className="active">1</button><button>2</button><button>3</button><button>›</button></div></div>}

function CitizenPage({ view, nav, application, paid, onSubmit, onPay, onSelectService, services }: {view:string;nav:(v:string)=>void;application:ApplicationRecord;paid:boolean;onSubmit:(values:ApplicationFormValues)=>Promise<void>;onPay:()=>Promise<boolean>;onSelectService:(service:Service)=>void;services:Service[]}) {
  if(view==="dashboard") return <CitizenDashboard nav={nav} application={application} paid={paid} sandbox={sandboxMode}/>;
  if(view==="services") return <><PageHeader title="Government Services" subtitle="Choose a service and start your application."/><div className="service-grid">{services.map(s=><ServiceCard service={s} onApply={()=>onSelectService(s)} key={s.name}/>)}</div></>;
  if(view==="applications") return <><PageHeader title="My Applications" subtitle="Track all submitted service requests." action={<Button onClick={()=>nav("apply")}>New application</Button>}/><section className="panel"><FilterBar search="Search applications..."/><ApplicationTable nav={nav} application={application} paid={paid} sandbox={sandboxMode}/>{sandboxMode&&<Pagination/>}</section></>;
  if(view==="application-detail") return <ApplicationDetail nav={nav} application={application} paid={paid}/>;
  if(view==="apply") return <ApplicationForm service={application.service} onSubmit={onSubmit}/>;
  if(view==="invoices") return <Invoice nav={nav} application={application} paid={paid}/>;
  if(view==="payment") return <Payment nav={nav} application={application} onPay={onPay}/>;
  if(view==="payment-processing") return <PaymentSuccess nav={nav} application={application}/>;
  if(view==="receipts") return <Receipt application={application}/>;
  if(view==="payments") return <><PageHeader title="Payments" subtitle="View and manage your payment history."/><section className="panel"><FilterBar search="Search payment reference..."/><PaymentTable application={application} paid={paid} sandbox={sandboxMode}/>{sandboxMode&&<Pagination/>}</section></>;
  if(view==="profile") return <Profile/>;
  return <CitizenDashboard nav={nav} application={application} paid={paid} sandbox={sandboxMode}/>;
}

function ApplicationForm({service,onSubmit}:{service:Service;onSubmit:(values:ApplicationFormValues)=>Promise<void>}) {
 const [error,setError]=useState("");
 const [submitting,setSubmitting]=useState(false);
  function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    void onSubmit({
      applicantName:String(fields.get("fullName")),
      applicantEmail:String(fields.get("email")),
      applicantPhone:String(fields.get("phone")),
      details:{
        applicantType:String(fields.get("applicantType")),
        requestName:String(fields.get("requestName")),
        category:String(fields.get("category")),
        supportingInformation:String(fields.get("details")),
        mobileMoneyNetwork:String(fields.get("mobileMoneyNetwork")),
      },
    }).catch((submitError:unknown)=>{
      setError(submitError instanceof Error?submitError.message:"Unable to submit this application.");
    }).finally(()=>setSubmitting(false));
  }
  return <><PageHeader title="Apply for a Service" subtitle="Complete the information below to submit your application."/><div className="application-layout"><form className="panel form-panel" onSubmit={submit}><div className="progress-steps">{["Information","Details","Review","Submit"].map((x,i)=><div className={i===0?"active":""} key={x}><span>0{i+1}</span><b>{x}</b></div>)}</div><h2>Applicant information</h2><p>Confirm the details for this application.</p><div className="field-grid"><Field label="Full name" name="fullName" placeholder="Alex Example" required/><Field label="Email address" name="email" type="email" placeholder="alex@example.com" required/><Field label="Phone number" name="phone" type="tel" placeholder="+260 000 000 000" required/><SelectField label="Mobile money network" name="mobileMoneyNetwork" options={["Select a network","MTN","Airtel","Zamtel"]} required/><SelectField label="Applicant type" name="applicantType" options={["Select an applicant type","Citizen","Business"]} required/></div><h2>Application details</h2><Field label="Proposed business or request name" name="requestName" placeholder="Example Trading Ltd" required/><SelectField label="Business category" name="category" options={["Select a category","Retail","Professional services","Other"]} required/><label className="field"><span>Supporting information</span><textarea name="details" placeholder="Add relevant context for this application" required /></label><div className="form-actions"><span className="sandbox-note">{sandboxMode?"Sandbox application — no real submission is made.":"Your information is submitted securely to GovPay."}</span><Button type="submit" icon="arrow">{submitting?"Submitting…":"Submit application"}</Button></div>{error&&<p className="form-error" role="alert">{error}</p>}</form><aside className="panel service-summary"><Badge tone="neutral">{service.category.toUpperCase()} SERVICE</Badge><h2>{service.name}</h2><p>{service.description}</p><hr/><div><span>Application fee</span><b>{service.fee}</b></div><div><span>Processing time</span><b>{service.time}</b></div><div><span>Environment</span><b>{sandboxMode?"Sandbox":"Production"}</b></div></aside></div></>;
}

function ApplicationDetail({nav,application,paid}:{nav:(v:string)=>void;application:ApplicationRecord;paid:boolean}) {
 const status = paid ? "Completed" : application.status;
 return <><div className="breadcrumb">Applications / <b>{application.reference}</b></div><PageHeader title={application.service.name} subtitle={`Application ${application.reference}`} action={!paid&&<Button onClick={()=>nav("invoices")} icon="arrow">Pay now — {application.service.fee}</Button>}/><div className="detail-banner"><div><span>CURRENT STATUS</span><Status value={status}/></div><p>{paid?"Your payment is confirmed. Your receipt is ready.":"Your application has been received. Review its details before continuing to payment."}</p></div><div className="detail-grid"><section className="panel"><h2>Application timeline</h2><div className="timeline">{[["Application submitted",application.date],["Review status",sandboxMode?"Sandbox workflow":"Awaiting service review"],[paid?"Payment complete":"Payment required",paid?(sandboxMode?"Paid in sandbox":"Confirmed by Flutterwave"):"Awaiting payment"]].map((x,i)=><div className="timeline-item" key={x[0]}><i className={i<2||paid?"done":"current"}>{i<2||paid?<Icon name="check" size={14}/>:i+1}</i><span><b>{x[0]}</b><small>{x[1]}</small></span></div>)}</div></section><section className="panel info-list"><h2>Application information</h2><Info label="Reference" value={application.reference}/><Info label="Applicant" value={application.applicant}/><Info label="Email" value={application.email}/><Info label="Service" value={application.service.name}/><Info label="Submitted" value={application.date}/></section></div></>;
}
function Info({label,value}:{label:string;value:string}){return <div className="info-row"><span>{label}</span><b>{value}</b></div>}

function Invoice({nav,application,paid}:{nav:(v:string)=>void;application:ApplicationRecord;paid:boolean}) {
 const invoiceReference = application.invoiceReference||application.reference.replace("APP","INV");
 return <><PageHeader title="Invoice" subtitle="Review the amount due before continuing."/><div className="document-shell"><section className="paper"><div className="paper-head"><Logo/><div><span>{sandboxMode?"SANDBOX INVOICE":"GOVPAY INVOICE"}</span><b>{invoiceReference}</b></div></div><div className="paper-status"><div><small>BILLED TO</small><b>{application.applicant}</b><span>{application.email}</span></div><div><small>STATUS</small><Badge tone={paid?"success":"danger"}>{paid?"PAID":"UNPAID"}</Badge></div></div><div className="invoice-line"><div><b>{application.service.name}</b><span>Application: {application.reference}</span></div><b>{application.service.fee}</b></div><div className="total-line"><span>{paid?"Amount paid":"Amount due"}</span><strong>{application.service.fee}</strong><small>{paid?"Payment complete":"Due in 14 days"}</small></div>{sandboxMode&&<div className="paper-note">SANDBOX DOCUMENT — This invoice has no monetary value.</div>}</section><aside className="panel payment-aside"><h2>Payment summary</h2><Info label="Subtotal" value={application.service.fee}/><Info label="Fees" value="K 0.00"/><Info label="Total" value={application.service.fee}/>{paid?<Badge tone="success">Paid</Badge>:<Button onClick={()=>nav("payment")} icon="arrow">Proceed to payment</Button>}<Button variant="secondary" icon="download" onClick={()=>window.print()}>Print invoice</Button><p><Icon name="shield" size={17}/> {sandboxMode?"Simulated payment environment":"Payment processed by Flutterwave"}</p></aside></div></>;
}

function Payment({nav,application,onPay}:{nav:(v:string)=>void;application:ApplicationRecord;onPay:()=>Promise<boolean>}) {
 const [method,setMethod]=useState("Mobile Money");
 const [error,setError]=useState("");
 const [submitting,setSubmitting]=useState(false);
 async function submit(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();
  setError("");
  setSubmitting(true);
  try{
   const redirected=await onPay();
   if(!redirected) nav("payment-processing");
  }catch(paymentError){
   setError(paymentError instanceof Error?paymentError.message:"Unable to start payment.");
  }finally{
   setSubmitting(false);
  }
 }
 return <><PageHeader title="Complete Payment" subtitle={sandboxMode?"Choose a sandbox method to complete this sandbox payment.":"Pay using Zambia mobile money through Flutterwave checkout."}/><div className="payment-layout"><form className="panel payment-form" onSubmit={submit}><div className="alert warning"><Icon name="shield"/><div><b>{sandboxMode?"Sandbox payment":"Secure payment"}</b><span>{sandboxMode?"No real money, card, bank account, or mobile wallet will be used.":"Your payment is handled by Flutterwave. Card details are never collected here."}</span></div></div><h2>Payment method</h2>{sandboxMode?<div className="method-grid">{["Bank Transfer","Card","Mobile Money"].map(x=><button type="button" className={method===x?"active":""} onClick={()=>setMethod(x)} key={x}><Icon name={x==="Card"?"wallet":"building"}/><b>{x}</b><span>{method===x&&<Icon name="check" size={15}/>}</span></button>)}</div>:<div className="alert info"><Icon name="wallet"/><div><b>Zambia mobile money · ZMW</b><span>You will authorize the payment on your mobile device after continuing.</span></div></div>}{sandboxMode&&method==="Bank Transfer"&&<SelectField label="Select sandbox bank" options={["Select a sandbox bank","Sandbox Bank","National Sandbox Bank","Sample Commercial Bank"]} required/>}{sandboxMode&&method==="Card"&&<><Field label="Sandbox card number" name="cardNumber" placeholder="0000 0000 0000 0000" required/><div className="field-grid"><Field label="Expiry" name="expiry" placeholder="MM / YY" required/><Field label="Security code" name="securityCode" placeholder="000" required/></div></>}{sandboxMode&&<label className="check-label confirm"><input type="checkbox" required/> I understand this is a simulated payment with no real money.</label>}<Button type="submit" icon="arrow">{submitting?"Starting checkout…":`Pay ${application.service.fee}`}</Button>{error&&<p className="form-error" role="alert">{error}</p>}</form><aside className="panel order-card"><span className="eyebrow">ORDER SUMMARY</span><h2>{application.service.name}</h2><Info label="Invoice" value={application.invoiceReference||application.reference.replace("APP","INV")}/><Info label="Application" value={application.reference}/><hr/><div className="order-total"><span>Total due</span><b>{application.service.fee}</b></div><p><Icon name="shield" size={17}/> {sandboxMode?"Processed in the GovPay sandbox environment.":"Payment is confirmed by the provider."}</p></aside></div></>;
}

function PaymentSuccess({nav,application}:{nav:(v:string)=>void;application:ApplicationRecord}) {
 return <div className="success-wrap"><div className="success-icon"><Icon name="check" size={34}/></div><span className="eyebrow">PAYMENT COMPLETE</span><h1>Payment successful</h1><p>{sandboxMode?"Your simulated payment was processed successfully.":"Your payment was verified with Flutterwave."}</p><strong>{application.service.fee}</strong><section className="panel success-details"><Info label="Payment reference" value={application.paymentReference||application.reference.replace("APP","PAY")}/><Info label={sandboxMode?"Bank reference":"Provider transaction"} value={application.providerTransactionId||application.reference.replace("APP","BANK")}/><Info label="Date" value={application.date}/><Info label="Status" value="PAID"/></section><div className="button-row"><Button onClick={()=>nav("receipts")}>View receipt</Button><Button variant="secondary" onClick={()=>nav("dashboard")}>Back to dashboard</Button></div>{sandboxMode&&<small>SANDBOX TRANSACTION — NO REAL MONEY WAS PROCESSED</small>}</div>;
}

function Receipt({application}:{application:ApplicationRecord}) {
 return <><PageHeader title="Payment Receipt" subtitle="A printable record of your sandbox transaction." action={<Button icon="download" onClick={()=>window.print()}>Print receipt</Button>}/><section className="paper receipt-paper"><div className="paper-head"><Logo/><div><span>SANDBOX PAYMENT RECEIPT</span><b>{application.reference.replace("APP","RCT")}</b></div></div><div className="paid-stamp"><Icon name="check"/><span>PAID</span></div><div className="receipt-amount"><small>AMOUNT PAID</small><strong>{application.service.fee}</strong><span>{application.date}</span></div><div className="receipt-grid"><Info label="Payer" value={application.applicant}/><Info label="Service" value={application.service.name}/><Info label="Application" value={application.reference}/><Info label="Invoice" value={application.reference.replace("APP","INV")}/><Info label="Payment method" value="Sandbox payment"/><Info label="Payment reference" value={application.reference.replace("APP","PAY")}/><Info label="Bank reference" value={application.reference.replace("APP","BANK")}/><Info label="Status" value="PAID"/></div><div className="paper-note strong">SANDBOX SYSTEM — NO REAL MONEY</div></section></>;
}

function Profile(){
 return <><PageHeader title="Profile" subtitle="Manage your personal information and account security."/><div className="profile-grid"><section className="panel"><h2>Profile information</h2><div className="field-grid"><Field label="Full name" placeholder="Alex Example"/><Field label="Email" placeholder="alex@example.com"/><Field label="Phone" placeholder="+260 000 000 000"/><Field label="Account type" placeholder="Citizen"/></div><Button>Save changes</Button></section><aside><section className="panel"><h2>Security</h2><p>Update your password regularly to protect your sandbox account.</p><Button variant="secondary">Change password</Button></section><section className="panel danger-zone"><h2>Account</h2><p>Sign out of your GovPay session on this device.</p><Button variant="danger">Log out</Button></section></aside></div></>;
}

function AdminDashboard({nav}:{nav:(v:string)=>void}) {
 return <><PageHeader title="Operations overview" subtitle="Revenue, applications and reconciliation at a glance." action={<Badge tone="pending">SANDBOX ENVIRONMENT</Badge>}/><div className="stats-grid five"><StatCard label="Total Revenue" value="K 245,850" note="+12.4% this month"/><StatCard label="Today’s Revenue" value="K 12,450" note="43 transactions"/><StatCard label="Applications" value="1,284" note="82 awaiting review"/><StatCard label="Pending Payments" value="47" note="K 18,900 value"/><StatCard label="Unreconciled" value="12" note="Needs attention" accent/></div><div className="chart-grid"><section className="panel"><PanelTitle title="Revenue by month"/><div className="chart"><div className="chart-axis"><span>300k</span><span>200k</span><span>100k</span><span>0</span></div><svg viewBox="0 0 600 180" preserveAspectRatio="none"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#C2410C" stopOpacity=".18"/><stop offset="1" stopColor="#C2410C" stopOpacity="0"/></linearGradient></defs><path d="M0 145 C70 135 85 120 135 124 S220 80 270 92 S355 72 405 79 S500 34 600 28 V180 H0Z" fill="url(#fill)"/><path d="M0 145 C70 135 85 120 135 124 S220 80 270 92 S355 72 405 79 S500 34 600 28" fill="none" stroke="#C2410C" strokeWidth="3"/></svg><div className="chart-labels">{["May","Jun","Jul","Aug","Sep","Oct"].map(x=><span key={x}>{x}</span>)}</div></div></section><section className="panel"><PanelTitle title="Revenue by service"/><div className="bar-list">{[["Business Registration",82],["Business Permit",67],["License Application",48],["Certificates",31]].map(x=><div key={x[0]}><span><b>{x[0]}</b><small>K {Number(x[1])*950}.00</small></span><i><b style={{width:`${x[1]}%`}}/></i></div>)}</div></section></div><section className="panel"><PanelTitle title="Recent transactions" action={()=>nav("payments")}/><PaymentTable/></section></>;
}

const adminApplications=[
 ["APP-2026-00124","Alex Example","Business Registration","06 Oct 2026","Payment Required","J. Phiri"],
 ["APP-2026-00123","Mwamba Traders","Business Permit","06 Oct 2026","Under Review","T. Banda"],
 ["APP-2026-00122","Jamie Example","Certificate Request","05 Oct 2026","Approved","J. Phiri"],
];

function AdminPage({view,nav}:{view:string;nav:(v:string)=>void}){
 if(view==="dashboard") return <AdminDashboard nav={nav}/>;
 if(view==="applications") return <><PageHeader title="Applications" subtitle="Review, assign and manage submitted applications."/><section className="panel"><FilterBar search="Search reference or applicant..."/><DataTable columns={["Reference","Applicant","Service","Submitted","Status","Officer",""]} rows={adminApplications.map(r=>[<b>{r[0]}</b>,r[1],r[2],r[3],<Status value={r[4]}/>,r[5],<button className="table-action" onClick={()=>nav("application-review")}>Review</button>])}/><Pagination/></section></>;
 if(view==="application-review") return <AdminReview/>;
 if(view==="services") return <ServiceManagement/>;
 if(view==="payments") return <AdminPayments/>;
 if(view==="payment-detail") return <AdminPaymentDetail/>;
 if(view==="reconciliation") return <Reconciliation nav={nav}/>;
 if(view==="reconciliation-details") return <ReconciliationDetails/>;
 if(view==="reports") return <Reports/>;
 if(view==="users") return <Users/>;
 if(view==="audit-logs") return <AuditLogs/>;
 return <AdminDashboard nav={nav}/>;
}

function AdminReview(){
 return <><div className="breadcrumb">Applications / <b>APP-2026-00123</b></div><PageHeader title="Application review" subtitle="Mwamba Traders · Business Permit" action={<div className="button-row"><Button variant="secondary">Request information</Button><Button variant="danger">Reject</Button><Button>Approve</Button></div>}/><div className="detail-grid"><section className="panel"><h2>Submitted information</h2><Info label="Legal business name" value="Mwamba Traders"/><Info label="Registration number" value="SANDBOX-839201"/><Info label="Business category" value="General retail"/><Info label="Operating address" value="14 Example Road, Sandbox City"/><h2>Supporting information</h2><div className="file-row"><Icon name="file"/><span><b>registration-document.pdf</b><small>PDF · 1.2 MB · Sandbox file</small></span><Button variant="text">View</Button></div></section><aside><section className="panel info-list"><h2>Applicant details</h2><Info label="Applicant" value="Mwamba Traders"/><Info label="Contact" value="Morgan Example"/><Info label="Email" value="morgan@example.com"/><Info label="Submitted" value="06 Oct 2026, 08:42"/><Info label="Assigned officer" value="T. Banda"/></section><section className="panel"><h2>Application timeline</h2><div className="timeline compact"><div className="timeline-item"><i className="done"><Icon name="check" size={14}/></i><span><b>Submitted</b><small>06 Oct, 08:42</small></span></div><div className="timeline-item"><i className="current">2</i><span><b>Under review</b><small>06 Oct, 09:10</small></span></div></div></section></aside></div></>;
}

function ServiceManagement(){
 return <><PageHeader title="Government Services" subtitle="Configure the fictional services available on GovPay." action={<Button>Add service</Button>}/><section className="panel"><FilterBar search="Search services..."/><DataTable columns={["Service","Category","Fee","Status","Updated","Actions"]} rows={services.slice(0,4).map((s,i)=>[<b>{s.name}</b>,s.category,s.fee,<Status value={i===3?"Inactive":"Active"}/>,"04 Oct 2026",<button className="table-action">Edit</button>])}/></section><section className="panel modal-preview"><div><Badge tone="neutral">CREATE / EDIT MODAL</Badge><h2>Service details</h2><p>Reusable form for adding and updating services.</p></div><div className="field-grid"><Field label="Service name"/><SelectField label="Category" options={["Business","Licensing","Documents","Other"]}/><Field label="Fee" placeholder="K 0.00"/><Field label="Processing time"/><Field label="Description"/><SelectField label="Status" options={["Active","Inactive"]}/></div><div className="form-actions"><Button variant="secondary">Cancel</Button><Button>Save service</Button></div></section></>;
}

function AdminPayments(){
 return <><PageHeader title="Payments" subtitle="Monitor all simulated payment activity."/><div className="stats-grid"><StatCard label="Total Payments" value="2,481"/><StatCard label="Successful" value="2,392"/><StatCard label="Pending" value="47"/><StatCard label="Failed" value="42"/><StatCard label="Total Revenue" value="K 245,850" accent/></div><section className="panel"><FilterBar search="Search payment, invoice, applicant..."/><DataTable columns={["Payment reference","Invoice","Applicant","Amount","Method","Status","Date"]} rows={payments.map((r,i)=>[<b>{r[0]}</b>,`INV-2026-000${124-i*22}`,["Alex Example","Morgan Example","Jamie Example"][i],r[2],"Sandbox Bank",<Status value={r[4]}/>,r[3]])}/><Pagination/></section></>;
}

function AdminPaymentDetail(){
 return <><PageHeader title="Payment details" subtitle="PAY-2026-000124" action={<Status value="Successful"/>}/><div className="detail-grid"><section className="panel info-list"><h2>Payment information</h2><Info label="Payment reference" value="PAY-2026-000124"/><Info label="Amount" value="K 500.00"/><Info label="Method" value="Sandbox Bank Transfer"/><Info label="Date" value="06 Oct 2026"/><h2>Invoice information</h2><Info label="Invoice" value="INV-2026-000124"/><Info label="Application" value="APP-2026-00124"/></section><aside><section className="panel info-list"><h2>Bank transaction information</h2><Info label="Bank reference" value="BANK-2026-000871"/><Info label="Bank" value="Sandbox Bank"/><Info label="Response" value="SUCCESSFUL"/><Info label="Environment" value="SANDBOX"/></section><section className="panel"><h2>Audit history</h2><p>Payment initiated · 14:07</p><p>Bank response received · 14:08</p><p>Payment completed · 14:08</p></section></aside></div></>;
}

const reconciliationRows=[
 ["PAY-2026-00124","BANK-2026-00981","K 500.00","K 500.00","K 0.00","MATCHED","06 Oct"],
 ["PAY-2026-00123","—","K 350.00","—","K 350.00","UNMATCHED","06 Oct"],
 ["PAY-2026-00122","BANK-2026-00979","K 500.00","K 450.00","K 50.00","AMOUNT MISMATCH","05 Oct"],
 ["PAY-2026-00121","BANK-2026-00978","K 120.00","K 120.00","K 0.00","PENDING REVIEW","05 Oct"],
];
function Reconciliation({nav}:{nav:(v:string)=>void}){
 return <><PageHeader title="Payment Reconciliation" subtitle="Compare GovPay records with fictional bank transactions." action={<Button icon="trend">Run reconciliation</Button>}/><div className="stats-grid"><StatCard label="Matched" value="2,340" note="94.3% of transactions"/><StatCard label="Unmatched" value="8" note="K 3,200.00"/><StatCard label="Amount Mismatch" value="4" note="K 650.00 difference" accent/><StatCard label="Pending Review" value="12" note="Awaiting finance team"/></div><section className="panel"><div className="alert info"><Icon name="shield"/><div><b>Last reconciliation run</b><span>06 Oct 2026 at 16:40 by Finance Officer · Sandbox environment</span></div></div><FilterBar search="Search GovPay or bank reference..."/><DataTable columns={["GovPay Reference","Bank Reference","GovPay Amount","Bank Amount","Difference","Status","Date",""]} rows={reconciliationRows.map(r=>[<b>{r[0]}</b>,r[1],r[2],r[3],r[4],<Status value={r[5]}/>,r[6],<button className="table-action" onClick={()=>nav("reconciliation-details")}>{r[5]==="MATCHED"?"View details":"Review exception"}</button>])}/></section></>;
}

function ReconciliationDetails(){
 return <><div className="breadcrumb">Reconciliation / <b>PAY-2026-00124</b></div><PageHeader title="Reconciliation details" subtitle="Transaction comparison and audit information." action={<Button variant="secondary">Add note</Button>}/><div className="compare-grid"><section className="panel transaction-card"><span className="eyebrow">GOVPAY TRANSACTION</span><Icon name="wallet"/><Info label="Payment reference" value="PAY-2026-00124"/><Info label="Amount" value="K 500.00"/><Info label="Date" value="06 Oct 2026"/><Info label="Status" value="Successful"/></section><section className="panel transaction-card"><span className="eyebrow">BANK TRANSACTION · SANDBOX</span><Icon name="building"/><Info label="Bank reference" value="BANK-2026-00981"/><Info label="Amount" value="K 500.00"/><Info label="Date" value="06 Oct 2026"/><Info label="Status" value="Successful"/></section></div><div className="match-result"><div className="success-icon"><Icon name="check"/></div><div><Badge tone="success">MATCHED</Badge><h2>Transaction successfully reconciled.</h2><p>References, amounts and transaction dates meet the configured matching rules.</p></div><Button variant="secondary">Mark as reviewed</Button></div></>;
}

function Reports(){
 return <><PageHeader title="Revenue Reports" subtitle="Analyze simulated revenue and transaction performance." action={<Button icon="download">Export report</Button>}/><section className="panel report-filters"><SelectField label="Date range" options={["01 Sep – 06 Oct 2026"]}/><SelectField label="Service" options={["All services"]}/><SelectField label="Payment status" options={["All statuses"]}/><Button>Apply filters</Button></section><div className="stats-grid"><StatCard label="Total Revenue" value="K 245,850"/><StatCard label="Transactions" value="2,481"/><StatCard label="Average Transaction" value="K 99.09"/><StatCard label="Successful Payments" value="96.4%"/></div><div className="chart-grid"><section className="panel"><h2>Revenue over time</h2><div className="bar-chart">{[45,62,54,78,68,88,72,95,84,100,92,108].map((x,i)=><i key={i} style={{height:`${x}px`}}/>)}</div></section><section className="panel"><h2>Payment status distribution</h2><div className="donut"/><div className="legend"><span><i/>Successful 96.4%</span><span><i/>Pending 1.9%</span><span><i/>Failed 1.7%</span></div></section></div></>;
}

function Users(){
 const rows=[["Alex Example","alex@example.com","Citizen","Active"],["Mwamba Traders","morgan@example.com","Business","Active"],["T. Banda","t.banda@example.com","Government Officer","Active"],["Finance Example","finance@example.com","Finance Officer","Inactive"],["Bank Operator","bank@example.com","Bank Admin","Active"]];
 return <><PageHeader title="Users" subtitle="Manage access and roles across the platform." action={<Button>Add user</Button>}/><section className="panel"><FilterBar search="Search name or email..."/><DataTable columns={["Name","Email","Role","Status","Created","Actions"]} rows={rows.map(r=>[<b>{r[0]}</b>,r[1],r[2],<Status value={r[3]}/>,"12 Sep 2026",<button className="table-action">Manage</button>])}/><Pagination/></section></>;
}
function AuditLogs(){
 const rows=[["06 Oct 2026, 14:08","Alex Example","Payment Completed","PAY-2026-000124","Sandbox payment marked successful","Success"],["06 Oct 2026, 14:05","J. Phiri","Application Approved","APP-2026-00124","Business registration approved","Success"],["06 Oct 2026, 12:32","T. Banda","Service Updated","SRV-004","Service fee updated","Success"],["06 Oct 2026, 10:11","System","Reconciliation Completed","RUN-2026-342","2,352 records processed","Success"]];
 return <><PageHeader title="Audit Logs" subtitle="Review sample activity in this sandbox workspace."/><section className="panel"><FilterBar search="Search user, action or entity..."/><DataTable columns={["Timestamp","User","Action","Entity","Description","Status"]} rows={rows.map(r=>[r[0],<b>{r[1]}</b>,r[2],r[3],r[4],<Status value={r[5]}/>])}/><Pagination/></section></>;
}

function BankPortal({view,navigate,exit}:{view:string;navigate:(v:string)=>void;exit:()=>void}){
 const bankRows=[["BANK-2026-000871","PAY-2026-000124","K 500.00","Successful","06 Oct, 14:08"],["BANK-2026-000870","PAY-2026-000123","K 350.00","Pending","06 Oct, 13:52"],["BANK-2026-000869","PAY-2026-000122","K 120.00","Failed","06 Oct, 12:14"]];
 return <div className="bank-page"><header><div className="bank-logo"><span>DB</span><div><b>SANDBOX BANK</b><small>SANDBOX ENVIRONMENT</small></div></div><div className="bank-warning">No real money is processed</div><button onClick={exit}>Exit sandbox</button></header><main><div className="bank-title"><div><span>BANK OPERATIONS CONSOLE</span><h1>{view==="detail"?"Transaction details":"Payment requests"}</h1><p>Standalone fictional bank simulator for the GovPay platform.</p></div><Badge tone="info">SANDBOX ENVIRONMENT</Badge></div>{view==="detail"?<><button className="back-link" onClick={()=>navigate("dashboard")}>← Back to transactions</button><div className="bank-detail"><section><small>BANK TRANSACTION REFERENCE</small><h2>BANK-2026-000871</h2><Status value="Successful"/></section><div><Info label="GovPay Payment Reference" value="PAY-2026-000124"/><Info label="Amount" value="K 500.00"/><Info label="Status" value="SUCCESSFUL"/><Info label="Timestamp" value="06 Oct 2026, 14:08"/><Info label="Customer Reference" value="CUST-000123"/><Info label="Environment" value="SANDBOX"/></div><div className="bank-alert"><Icon name="shield"/><span>This transaction is simulated. It does not represent actual funds movement.</span></div></div></>:<><div className="stats-grid"><StatCard label="Payment Requests" value="1,284"/><StatCard label="Successful" value="1,215"/><StatCard label="Pending" value="47"/><StatCard label="Failed" value="22"/></div><section className="bank-table panel"><PanelTitle title="Recent transactions"/><DataTable columns={["Bank reference","GovPay reference","Amount","Status","Timestamp",""]} rows={bankRows.map(r=>[<b>{r[0]}</b>,r[1],r[2],<Status value={r[3]}/>,r[4],<button className="table-action" onClick={()=>navigate("detail")}>View</button>])}/></section></>}</main></div>;
}

function App() {
 const [page,setPage]=useState<Page>(()=>new URLSearchParams(window.location.search).has("payment_return")?{portal:"citizen",view:"payment-return"}:{portal:"public",view:"landing"});
 const [application,setApplication]=useState<ApplicationRecord>(()=>sandboxMode?initialApplication:emptyApplication);
 const [serviceCatalog,setServiceCatalog]=useState<Service[]>(sandboxMode?services:[]);
 const [paid,setPaid]=useState(false);
 const [applyAfterSignIn,setApplyAfterSignIn]=useState(false);
 const [session,setSession]=useState<Session|null>(null);
 const [authReady,setAuthReady]=useState(sandboxMode||!supabase);
 const [accountRole,setAccountRole]=useState("citizen");
 const [authError,setAuthError]=useState("");
 const [paymentMessage,setPaymentMessage]=useState("Verifying your payment with Flutterwave…");
 useEffect(()=>{
  if(sandboxMode||!supabase) return;
  const client=supabase;
  let active=true;
  const loadRole=(userId:string)=>{
   window.setTimeout(()=>{
    void (async()=>{
     try{
      const {data,error}=await client.from("profiles").select("account_role").eq("id",userId).single();
      if(!active) return;
      if(error){
       setAuthError(`Unable to load account permissions: ${error.message}`);
       return;
      }
      setAccountRole(data.account_role);
      setPage(current=>({
       portal:data.account_role==="government_admin"||data.account_role==="finance_officer"?"admin":"citizen",
       view:current.view==="login"||current.view==="register"?"dashboard":current.view,
      }));
     }catch(error){
      if(active) setAuthError(error instanceof Error?error.message:"Unable to load account permissions.");
     }
    })();
   },0);
  };
  const {data:{subscription}}=client.auth.onAuthStateChange((_event,nextSession)=>{
   if(!active) return;
   setSession(nextSession);
   if(nextSession) loadRole(nextSession.user.id);
   else {
    setAccountRole("citizen");
    setPage({portal:"public",view:"landing"});
   }
  });
  void client.auth.getSession().then(({data,error})=>{
   if(!active) return;
   if(error){
    setAuthError(`Unable to restore your session: ${error.message}`);
    setAuthReady(true);
    return;
   }
   setSession(data.session);
   if(data.session) loadRole(data.session.user.id);
   setAuthReady(true);
  }).catch((error:unknown)=>{
   if(active){
    setAuthError(error instanceof Error?error.message:"Unable to restore your session.");
    setAuthReady(true);
   }
  });
  return ()=>{active=false;subscription.unsubscribe();};
 },[]);
 useEffect(()=>{
  if(sandboxMode||!supabase||!session) return;
  const applicationId=sessionStorage.getItem("govpay.currentApplicationId");
  if(!applicationId) return;
  let active=true;
  void supabase.from("applications")
   .select("id,reference,applicant_name,applicant_email,status,created_at,services(id,name,category,description,fee_minor_units,currency,processing_time),invoices(id,reference,status,payments(reference,provider_transaction_id,status))")
   .eq("id",applicationId)
   .maybeSingle()
   .then(({data,error})=>{
    if(!active) return;
    if(error){
     setAuthError(`Unable to restore your application: ${error.message}`);
     return;
    }
    if(!data){
     sessionStorage.removeItem("govpay.currentApplicationId");
     return;
    }
    const serviceRecord=Array.isArray(data.services)?data.services[0]:data.services;
    const invoiceRecord=Array.isArray(data.invoices)?data.invoices[0]:data.invoices;
    const paymentRecord=Array.isArray(invoiceRecord?.payments)?invoiceRecord.payments[0]:invoiceRecord?.payments;
    if(!serviceRecord||!invoiceRecord){
     setAuthError("The saved application is missing its service or invoice record.");
     return;
    }
    const service:Service={
     id:serviceRecord.id,
     name:serviceRecord.name,
     category:serviceRecord.category,
     description:serviceRecord.description,
     feeMinorUnits:serviceRecord.fee_minor_units,
     currency:serviceRecord.currency,
     fee:`K ${(serviceRecord.fee_minor_units/100).toFixed(2)}`,
     time:serviceRecord.processing_time,
    };
    setApplication({
     id:data.id,
     invoiceId:invoiceRecord.id,
     invoiceReference:invoiceRecord.reference,
     reference:data.reference,
     service,
     applicant:data.applicant_name,
     email:data.applicant_email,
     date:new Date(data.created_at).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}),
     status:data.status==="paid"?"Completed":"Payment Required",
     paymentReference:paymentRecord?.reference,
     providerTransactionId:paymentRecord?.provider_transaction_id,
    });
    setPaid(invoiceRecord.status==="paid");
   });
  return ()=>{active=false;};
 },[session]);
 useEffect(()=>{
  if(sandboxMode||!supabase) return;
  let active=true;
  void supabase.from("services")
   .select("id,name,category,description,fee_minor_units,currency,processing_time")
   .eq("active",true)
   .order("name")
   .then(({data,error})=>{
    if(!active) return;
    if(error){
     setAuthError(`Unable to load available services: ${error.message}`);
     return;
    }
    setServiceCatalog((data||[]).map(service=>({
     id:service.id,
     name:service.name,
     category:service.category,
     description:service.description,
     feeMinorUnits:service.fee_minor_units,
     currency:service.currency,
     fee:`K ${(service.fee_minor_units/100).toFixed(2)}`,
     time:service.processing_time,
    })));
   });
  return ()=>{active=false;};
 },[]);
 const setView=(view:string)=>setPage(p=>({...p,view}));
 const enter=(portal:Portal)=>{
  if(!sandboxMode&&portal!=="public") return;
  const startApplication=portal==="citizen"&&applyAfterSignIn;
  setPage({portal,view:startApplication?"apply":"dashboard"});
  setApplyAfterSignIn(false);
 };
 const authenticate=async(mode:"login"|"register",values:AuthFormValues)=>{
  if(!supabase) throw new Error(supabaseConfigurationError||"Authentication is not configured.");
  setAuthError("");
  let userId:string;
  if(mode==="register"){
   const {data,error}=await supabase.auth.signUp({
    email:values.email,
    password:values.password,
    options:{data:{full_name:values.fullName,account_type:values.accountType,business_name:values.businessName,registration_number:values.registrationNumber,phone:values.phone}},
   });
   if(error) throw error;
   if(!data.session) return "Check your email to confirm your account before signing in.";
   setSession(data.session);
   userId=data.session.user.id;
  }else{
   const {data,error}=await supabase.auth.signInWithPassword({email:values.email,password:values.password});
   if(error) throw error;
   setSession(data.session);
   userId=data.session.user.id;
  }
  const {data:profile,error:profileError}=await supabase.from("profiles").select("account_role").eq("id",userId).single();
  if(profileError) throw profileError;
  setAccountRole(profile.account_role);
  setPage({
   portal:profile.account_role==="government_admin"||profile.account_role==="finance_officer"?"admin":"citizen",
   view:new URLSearchParams(window.location.search).has("payment_return")?"payment-return":applyAfterSignIn?"apply":"dashboard",
  });
  setApplyAfterSignIn(false);
  return undefined;
 };
 const exit=async()=>{
  if(!sandboxMode&&supabase){
   const {error}=await supabase.auth.signOut();
   if(error){setAuthError(`Unable to sign out: ${error.message}`);return;}
  }
  sessionStorage.removeItem("govpay.currentApplicationId");
  setPage({portal:"public",view:"landing"});
 };
 const selectService=(service:Service)=>{
  setApplication(current=>({...current,service}));
  setPaid(false);
  if(page.portal==="citizen"){
   setPage({portal:"citizen",view:"apply"});
  } else {
   setApplyAfterSignIn(true);
   setPage({portal:"public",view:"login"});
  }
 };
 const submitApplication=async(values:ApplicationFormValues)=>{
  const year=new Date().getFullYear();
  const suffix=String(Date.now()).slice(-6);
  const date=new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});
  if(!sandboxMode){
   if(!supabase) throw new Error(supabaseConfigurationError||"The application service is not configured.");
   if(!application.service.id) throw new Error("This service is not available for applications yet.");
   const {data,error}=await supabase.rpc("submit_application",{
    p_service_id:application.service.id,
    p_applicant_name:values.applicantName,
    p_applicant_email:values.applicantEmail,
    p_applicant_phone:values.applicantPhone,
    p_details:values.details,
   });
   if(error) throw new Error(`Unable to submit application: ${error.message}`);
   const row=Array.isArray(data)?data[0]:data;
   if(!row) throw new Error("The application service returned no application reference.");
   const savedApplication:ApplicationRecord={
    id:row.application_id,
    invoiceId:row.invoice_id,
    invoiceReference:row.invoice_reference,
    reference:row.application_reference,
    service:application.service,
    applicant:values.applicantName,
    email:values.applicantEmail,
    date,
    status:"Payment Required",
   };
   setApplication(savedApplication);
   sessionStorage.setItem("govpay.currentApplicationId",savedApplication.id||"");
  }else{
   setApplication(current=>({...current,reference:`APP-${year}-${suffix}`,applicant:values.applicantName,email:values.applicantEmail,date,status:"Payment Required"}));
  }
  setPaid(false);
  setPage({portal:"citizen",view:"application-detail"});
 };
 const startPayment=async()=>{
  if(sandboxMode){
   setPaid(true);
   return false;
  }
  if(!supabase||!application.id) throw new Error("A saved application is required before payment.");
  const {data,error}=await supabase.functions.invoke("create-checkout",{
   body:{applicationId:application.id},
  });
  if(error) throw new Error(`Unable to start checkout: ${error.message}`);
  if(typeof data?.checkoutUrl!=="string") throw new Error("The payment service returned no checkout URL.");
  const checkoutUrl=new URL(data.checkoutUrl);
  const trustedHost=checkoutUrl.hostname.endsWith(".flutterwave.com")||checkoutUrl.hostname.endsWith(".dev-flutterwave.com");
  if(checkoutUrl.protocol!=="https:"||!trustedHost) {
   throw new Error("The payment service returned an untrusted checkout URL.");
  }
  window.location.assign(checkoutUrl.toString());
  return true;
 };
 useEffect(()=>{
  if(sandboxMode||!supabase||!session||page.view!=="payment-return") return;
  let active=true;
  void (async()=>{
   const params=new URLSearchParams(window.location.search);
   const txRef=params.get("tx_ref");
   const transactionId=params.get("transaction_id");
   if(!txRef||!transactionId){
    setPaymentMessage("The payment provider did not return a verifiable transaction. Check your payment history or contact support.");
    setPage({portal:"citizen",view:"payment-pending"});
    return;
   }
   const {data,error}=await supabase.functions.invoke("verify-checkout",{
    body:{txRef,transactionId},
   });
   if(!active) return;
   if(error){
    setPaymentMessage(`Unable to verify payment: ${error.message}`);
    setPage({portal:"citizen",view:"payment-pending"});
    return;
   }
   if(data?.status!=="successful"){
    setPaymentMessage("The payment is still being confirmed. Check your payment history before trying again.");
    setPage({portal:"citizen",view:"payment-pending"});
    return;
   }
   const service:Service={
    ...data.application.service,
    fee:`K ${(data.amountMinorUnits/100).toFixed(2)}`,
    feeMinorUnits:data.amountMinorUnits,
    currency:data.currency,
   };
   setApplication({
    id:data.application.id,
    invoiceReference:data.invoiceReference,
    reference:data.application.reference,
    applicant:data.application.applicant,
    email:data.application.email,
    service,
    date:new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}),
    status:"Completed",
    paymentReference:data.paymentReference,
    providerTransactionId:data.providerTransactionId,
   });
   setPaid(true);
   window.history.replaceState({},document.title,window.location.pathname);
   setPage({portal:"citizen",view:"payment-processing"});
  })().catch((error:unknown)=>{
   if(active){
    setPaymentMessage(error instanceof Error?`Unable to verify payment: ${error.message}`:"Unable to verify payment.");
    setPage({portal:"citizen",view:"payment-pending"});
   }
  });
  return ()=>{active=false;};
 },[page.view,session]);
 const content=useMemo(()=>{
  if(!authReady){
   return <div className="auth-page"><SandboxNotice/><main className="auth-shell"><p>Checking your sign-in status…</p></main></div>;
  }
  if(page.portal==="public"){
   if(page.view==="services"||page.view==="service-detail") return <ServicesPage go={setView} apply={selectService} services={serviceCatalog}/>;
   if(page.view==="login"||page.view==="register") return <Auth mode={page.view} go={setView} enter={enter} authenticate={authenticate} sandbox={sandboxMode}/>;
   return <Landing go={setView} apply={selectService} services={serviceCatalog}/>;
  }
  if(!sandboxMode&&!session){
   return <Auth mode="login" go={setView} enter={enter} authenticate={authenticate} sandbox={sandboxMode}/>;
  }
  if(!sandboxMode&&page.portal==="admin"&&accountRole==="citizen"){
   return <div className="auth-page"><main className="auth-shell"><p role="alert">Your account is not authorized to access the government workspace.</p><Button onClick={exit}>Sign out</Button></main></div>;
  }
  if(!sandboxMode&&page.portal==="bank"){
   return <div className="auth-page"><main className="auth-shell"><p role="alert">The bank operations workspace is not available in this account.</p></main></div>;
  }
  if(page.portal==="bank") return <BankPortal view={page.view} navigate={setView} exit={exit}/>;
  if(page.view==="payment-return") return <div className="auth-page"><SandboxNotice/><main className="auth-shell"><h1>Confirming payment</h1><p>{paymentMessage}</p></main></div>;
  if(page.view==="payment-pending") return <div className="auth-page"><SandboxNotice/><main className="auth-shell"><h1>Payment pending</h1><p role="status">{paymentMessage}</p><Button onClick={()=>setPage({portal:"citizen",view:"payments"})}>View payments</Button></main></div>;
  return <>{authError&&<div className="form-error" role="alert">{authError}</div>}<PortalShell portal={page.portal} view={page.view} navigate={setView} exit={exit}>{page.portal==="citizen"?<CitizenPage view={page.view} nav={setView} application={application} paid={paid} onSubmit={submitApplication} onPay={startPayment} onSelectService={selectService} services={serviceCatalog}/>:sandboxMode?<AdminPage view={page.view} nav={setView}/>:<><PageHeader title="Government workspace" subtitle="Operational data and staff workflows are not yet enabled for this deployment."/><section className="panel"><h2>Production setup required</h2><p>Configure authorized staff roles and connect live application, service, payment, audit, and reporting data before enabling government operations.</p></section></>}</PortalShell></>;
 },[page,application,paid,applyAfterSignIn,session,authReady,accountRole,authError,serviceCatalog]);
 return <>{content}{sandboxMode&&<div className="sandbox-workspace-switcher"><span>Sandbox workspaces</span><button className={page.portal==="public"?"active":""} onClick={()=>setPage({portal:"public",view:"landing"})}>Public</button><button className={page.portal==="citizen"?"active":""} onClick={()=>enter("citizen")}>Citizen</button><button className={page.portal==="admin"?"active":""} onClick={()=>enter("admin")}>Government</button><button className={page.portal==="bank"?"active":""} onClick={()=>enter("bank")}>Sandbox Bank</button></div>}</>;
}

export default App;
