"use client";

import { useMemo, useState } from "react";

type Stage = "Overview" | "Canon" | "References" | "Dataset" | "Train" | "Create" | "Validate" | "Launch";

const stages: { name: Stage; icon: string }[] = [
  { name: "Overview", icon: "⌂" },
  { name: "Canon", icon: "◇" },
  { name: "References", icon: "▧" },
  { name: "Dataset", icon: "▤" },
  { name: "Train", icon: "△" },
  { name: "Create", icon: "◎" },
  { name: "Validate", icon: "✓" },
  { name: "Launch", icon: "↗" },
];

const characters = {
  Mara: { name: "Mara Vey", token: "mara_v", image: "/mara.png", status: "LoRA trained", accent: "cool", score: 86 },
  Lila: { name: "Lila Mercer", token: "lila_m", image: "/lila.png", status: "Canon locked", accent: "warm", score: 62 },
};

const stageCopy: Record<Stage, { eyebrow: string; title: string; description: string }> = {
  Overview: { eyebrow: "FOUNDRY OVERVIEW", title: "One identity. Every surface.", description: "Design, train, test, and deploy a reusable fictional avatar through one evidence-backed workflow." },
  Canon: { eyebrow: "01 — CANON", title: "Build a person, not a prompt.", description: "Lock the visual canon, behavioral presence, signature anchors, and prohibited drift before generating training material." },
  References: { eyebrow: "02 — REFERENCE STUDIO", title: "Coverage before volume.", description: "Plan a small, intentional reference set that teaches identity across angle, framing, expression, light, and wardrobe." },
  Dataset: { eyebrow: "03 — DATASET LAB", title: "Curate what the model learns.", description: "Audit every source image, eliminate contamination, and export a transparent, training-ready package." },
  Train: { eyebrow: "04 — TRAINING BAY", title: "Recommended settings, visible logic.", description: "Use a dataset-sized SDXL profile, preserve checkpoints, and keep the important controls understandable." },
  Create: { eyebrow: "05 — CREATE", title: "Recipes before random prompts.", description: "Assemble reproducible content recipes. This draft builds the recipe; generation remains a clearly labeled prototype action." },
  Validate: { eyebrow: "06 — VALIDATE", title: "A score must show its work.", description: "Review observable evidence, apply explicit rubrics, and route each failure back to the stage that can repair it." },
  Launch: { eyebrow: "07 — LAUNCH", title: "Release only what you can defend.", description: "Package durable artifacts, provenance, consent, validation evidence, and licensing boundaries behind a hard release gate." },
};

function ProgressRing({ value }: { value: number }) {
  return <div className="progress-ring" style={{ "--progress": `${value * 3.6}deg` } as React.CSSProperties}><span>{value}%</span></div>;
}

export default function Home() {
  const [stage, setStage] = useState<Stage>("Overview");
  const [avatar, setAvatar] = useState<"Mara" | "Lila">("Mara");
  const [copied, setCopied] = useState(false);
  const [purpose, setPurpose] = useState("Documentary portrait");
  const [expression, setExpression] = useState("Neutral, direct");
  const [setting, setSetting] = useState("Natural window light");
  const active = characters[avatar];
  const copy = stageCopy[stage];

  const prompt = useMemo(() => `photo of ${active.token} woman, ${purpose.toLowerCase()}, ${expression.toLowerCase()} expression, ${setting.toLowerCase()}, realistic skin texture, coherent identity, editorial photography`, [active, purpose, expression, setting]);

  function copyPrompt() {
    navigator.clipboard?.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setStage("Overview")} aria-label="Avatar Foundry home">
          <span className="brand-mark"><i />AF</span>
          <span><strong>AVATAR</strong><small>FOUNDRY</small></span>
        </button>

        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Foundry stages">
          {stages.map((item, index) => (
            <button key={item.name} className={stage === item.name ? "nav-item active" : "nav-item"} onClick={() => setStage(item.name)}>
              <span className="nav-icon">{item.icon}</span><span>{item.name}</span>{index > 0 ? <em>{index}</em> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className="project-switch" onClick={() => setAvatar(avatar === "Mara" ? "Lila" : "Mara")}>
            <img src={active.image} alt="" />
            <span><small>ACTIVE PROJECT</small><strong>{active.name}</strong><em>{active.status}</em></span>
            <b>⌄</b>
          </button>
          <p>Private working draft<br />v0.1 · July 2026</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand">AF <span>Avatar Foundry</span></div>
          <div className="project-tabs" aria-label="Select demonstration avatar">
            {(Object.keys(characters) as ("Mara" | "Lila")[]).map(key => <button key={key} className={avatar === key ? "selected" : ""} onClick={() => setAvatar(key)}>{characters[key].name}</button>)}
          </div>
          <div className="top-actions"><span className="mode-badge">PROTOTYPE WORKSPACE</span><span className="autosave">● Local demo state</span><button aria-label="More options">•••</button></div>
        </header>

        <div className="content">
          <section className="hero">
            <div>
              <p className="eyebrow"><span />{copy.eyebrow}</p>
              <h1>{copy.title}</h1>
              <p className="hero-copy">{copy.description}</p>
            </div>
            <div className="hero-avatar">
              <div className={`image-wrap ${active.accent}`}><img src={active.image} alt={`${active.name} canonical portrait`} /><span>{active.token}</span></div>
              <div><small>ACTIVE IDENTITY</small><strong>{active.name}</strong><p>{active.status}</p></div>
            </div>
          </section>

          {stage === "Overview" && <Overview active={active} setStage={setStage} />}
          {stage === "Canon" && <Identity active={active} />}
          {stage === "References" && <References avatar={avatar} />}
          {stage === "Dataset" && <Dataset avatar={avatar} />}
          {stage === "Train" && <Train avatar={avatar} />}
          {stage === "Create" && <Deploy purpose={purpose} setPurpose={setPurpose} expression={expression} setExpression={setExpression} setting={setting} setSetting={setSetting} prompt={prompt} copyPrompt={copyPrompt} copied={copied} />}
          {stage === "Validate" && <Validate avatar={avatar} />}
          {stage === "Launch" && <Launch avatar={avatar} />}
        </div>

        <div className="mobile-nav">{stages.map(item => <button key={item.name} className={stage === item.name ? "active" : ""} onClick={() => setStage(item.name)}><span>{item.icon}</span>{item.name}</button>)}</div>
      </section>
    </main>
  );
}

function Overview({ active, setStage }: { active: typeof characters.Mara; setStage: (s: Stage) => void }) {
  const cards: { stage: Stage; n: string; title: string; status: string; text: string }[] = [
    { stage: "Canon", n: "01", title: "Identity canon", status: "Locked record", text: "Visual anchors, presence, voice, drift rules" },
    { stage: "References", n: "02", title: "Reference set", status: active.name === "Mara Vey" ? "45 approved" : "1 of 30", text: "Coverage matrix and image-level curation" },
    { stage: "Dataset", n: "03", title: "Dataset audit", status: active.name === "Mara Vey" ? "Evidence recorded" : "Blocked", text: "Duplicates, captions, outliers, export manifest" },
    { stage: "Train", n: "04", title: "Identity LoRA", status: active.name === "Mara Vey" ? "Imported run" : "Blocked", text: "Guided cloud run with recoverable checkpoints" },
    { stage: "Create", n: "05", title: "Content recipes", status: "Prototype", text: "Parameterized prompts and controlled workflows" },
    { stage: "Validate", n: "06", title: "Acceptance evidence", status: active.name === "Mara Vey" ? "Needs review" : "Blocked", text: "Rubrics, failures, remediation, signed report" },
    { stage: "Launch", n: "07", title: "Release package", status: "Blocked", text: "Provenance, consent, validation, and licenses" },
  ];
  return <>
    <section className="trust-banner"><strong>Honest capability boundary</strong><span>Canon and recipe controls work in this draft. Upload, train, generate, validate, and export are demonstrated—not executed—until durable backend services are connected.</span></section>
    <section className="status-strip"><div><ProgressRing value={active.score} /><span><small>PROJECT READINESS</small><strong>{active.score >= 80 ? "Validation required" : "Reference build"}</strong></span></div><p><b>Next best action</b>{active.score >= 80 ? "Review the acceptance rubric and record evidence for signature-feature drift." : "Build Lila’s neutral, profile, three-quarter, and full-body reference coverage."}</p><button onClick={() => setStage(active.score >= 80 ? "Validate" : "References")}>Continue <span>→</span></button></section>
    <div className="section-heading"><div><p>THE RELIABILITY SPINE</p><h2>Seven gates to a defensible avatar</h2></div><span>Each gate requires a durable, inspectable artifact.</span></div>
    <section className="pipeline-grid">{cards.map((card, i) => <button key={card.n} className="pipeline-card" onClick={() => setStage(card.stage)}><div><span>{card.n}</span><em className={i < (active.score >= 80 ? 4 : 1) ? "done" : ""}>{i < (active.score >= 80 ? 4 : 1) ? "✓" : "·"}</em></div><h3>{card.title}</h3><p>{card.text}</p><footer><strong>{card.status}</strong><span>Open →</span></footer></button>)}</section>
    <section className="proof"><div><p className="eyebrow"><span />PROOF CASES</p><h2>Opposite people.<br />One neutral system.</h2><p>Mara tests restraint, field realism, and signature-feature retention. Lila tests polish, warmth, and expressive range. If both pass the same protocol, the pipeline generalizes.</p></div><div className="comparison"><article><img src="/mara.png" alt="Mara Vey"/><span><strong>Mara Vey</strong><small>Trained baseline</small></span><b>86</b></article><i>VERSUS</i><article><img src="/lila.png" alt="Lila Mercer"/><span><strong>Lila Mercer</strong><small>Inverse validation</small></span><b>62</b></article></div></section>
  </>;
}

function Identity({ active }: { active: typeof characters.Mara }) {
  const mara = active.name === "Mara Vey";
  const fields = mara ? [
    ["Face & complexion", "Medium olive skin · gray-green eyes · natural freckles"], ["Hair", "Dark, wavy, shoulder-length · narrow silver streak at left temple"], ["Presentation", "Field-functional · cool, weathered palette · anti-performative"], ["Default affect", "Guarded stillness · direct gaze · sparse emotional display"],
  ] : [["Face & complexion", "Light warm peach-beige · amber-brown eyes · natural texture"], ["Hair", "Honey blonde · collarbone-length · smooth layered blowout"], ["Presentation", "Cream-and-gold palette · curated softness · intentional polish"], ["Default affect", "Readable engagement · confiding half-smile · expressive warmth"]];
  return <section className="editor-grid"><div className="canon-card"><div className="canon-image"><img src={active.image} alt={active.name}/><span>CANONICAL REFERENCE · 01</span></div><div className="anchor"><small>SIGNATURE ANCHOR</small><strong>{mara ? "Silver left-temple streak" : "Delicate gold bracelet"}</strong><p>Recognizable, narratively grounded, and testable across generations.</p></div></div><div className="identity-fields"><div className="panel-title"><span>VISUAL CANON</span><b>4 / 4 locked</b></div>{fields.map(([name, value]) => <label key={name}><span>{name}</span><textarea defaultValue={value} /></label>)}<div className="guardrails"><span>PROHIBITED DRIFT</span><div>{(mara ? ["glam makeup", "bright blonde hair", "staged intimacy", "younger age"] : ["platinum hair", "heavy glam", "cool gray palette", "guarded affect"]).map(x => <em key={x}>{x} ×</em>)}</div></div><button className="primary">Lock canon & generate brief <span>→</span></button></div></section>;
}

function References({ avatar }: { avatar: "Mara" | "Lila" }) {
  const done = avatar === "Mara";
  const rows = [["Neutral headshot", done ? 8 : 1, 8], ["Three-quarter", done ? 8 : 0, 8], ["Left / right profile", done ? 6 : 0, 6], ["Full body", done ? 7 : 0, 8], ["Expression range", done ? 8 : 0, 8], ["Light & environment", done ? 8 : 0, 8]];
  return <section className="studio-layout"><div className="matrix"><div className="panel-title"><span>COVERAGE MATRIX</span><b>{done ? "45 approved" : "1 approved"}</b></div>{rows.map(([name, current, total]) => <div className="matrix-row" key={String(name)}><span>{name}</span><div><i style={{width:`${Number(current)/Number(total)*100}%`}} /></div><strong>{current}/{total}</strong></div>)}<div className="coverage-note"><b>{done ? "Coverage is balanced" : "29 references still needed"}</b><p>{done ? "The set spans enough controlled variation for identity training." : "Start with structural angles before adding styled scenes."}</p></div></div><div className="shot-plan"><div className="panel-title"><span>NEXT SHOT</span><b>REQUIRED</b></div><div className="shot-frame"><span className="face-guide">＋</span><small>RIGHT THREE-QUARTER</small></div><h3>Natural window portrait</h3><p>Chest-up · hairline visible · neutral wardrobe · direct natural light · no jewelry obstruction.</p><button className="primary">Copy generation brief</button><button className="secondary">Mark as sourced</button></div></section>;
}

function Dataset({ avatar }: { avatar: "Mara" | "Lila" }) {
  const ready = avatar === "Mara";
  return <section className="dataset-layout"><div className="audit-score"><ProgressRing value={ready ? 94 : 12}/><h3>{ready ? "Training ready" : "Not enough source material"}</h3><p>{ready ? "45 approved files · captions normalized · no identity outliers" : "Upload or source the planned Lila reference set first."}</p><button className="primary">{ready ? "Export training package" : "Open reference plan"}</button></div><div className="checks"><div className="panel-title"><span>AUTOMATED CHECKS</span><b>LAST RUN · NOW</b></div>{[["File integrity", ready ? "45 / 45 pass" : "1 / 1 pass", true], ["Exact duplicates", ready ? "0 found" : "0 found", true], ["Near duplicates", ready ? "3 reviewed" : "Not enough data", ready], ["Identity outliers", ready ? "0 found" : "Not enough data", ready], ["Caption coverage", ready ? "45 / 45" : "0 / 1", ready], ["Validation split", ready ? "5 reserved" : "Not created", ready]].map(([a,b,c]) => <div className="check-row" key={String(a)}><span className={c ? "pass" : "wait"}>{c ? "✓" : "·"}</span><strong>{a}</strong><em>{b}</em></div>)}</div><div className="manifest"><div className="panel-title"><span>EXPORT MANIFEST</span><b>TRANSPARENT BY DEFAULT</b></div><pre>{`trigger_token: ${ready ? "mara_v" : "lila_m"}\nbase_model: SDXL 1.0\napproved_images: ${ready ? 45 : 1}\nvalidation_images: ${ready ? 5 : 0}\ncaption_format: .txt sidecar\nconsent_status: fictional\ncreated: 2026-07-22`}</pre></div></section>;
}

function Train({ avatar }: { avatar: "Mara" | "Lila" }) {
  const ready = avatar === "Mara";
  return <section className="training-layout"><div className="recipe"><div className="panel-title"><span>RECOMMENDED PROFILE</span><b>SDXL · IDENTITY</b></div><h2>{ready ? "Balanced 45" : "Balanced 30"}</h2><p>Designed for coherent facial identity without flattening expression, wardrobe, or setting responsiveness.</p>{[["Training steps", ready ? "2,700" : "2,100"], ["Network rank / alpha", "32 / 16"], ["UNet learning rate", "1e-4"], ["Text encoder", "5e-6"], ["Optimizer", "AdamW8bit"], ["Checkpoint interval", "Every 450 steps"]].map(([a,b]) => <div className="setting" key={a}><span>{a}</span><strong>{b}</strong></div>)}<button className="primary" disabled={!ready}>{ready ? "Open guided trainer" : "Dataset required"}</button></div><div className="run-card"><div className="run-status"><span className={ready ? "pulse" : "idle"}/><div><small>{ready ? "LATEST RUN" : "TRAINING BAY"}</small><strong>{ready ? "Mara Vey v1.1" : "Waiting for Lila dataset"}</strong></div><b>{ready ? "COMPLETE" : "IDLE"}</b></div><div className="loss-chart"><div className="chart-line">⌁</div><span>LOSS</span><strong>{ready ? "0.093" : "—"}</strong></div><div className="artifacts"><h3>Run artifacts</h3>{["Identity LoRA (.safetensors)", "Configuration & seed", "Checkpoint samples", "Model card & provenance", "Test workflow"].map((x,i)=><div key={x}><span>{ready ? "✓" : "·"}</span>{x}<em>{ready ? (i===0?"218 MB":"Ready") : "Pending"}</em></div>)}</div></div></section>;
}

function Deploy({ purpose, setPurpose, expression, setExpression, setting, setSetting, prompt, copyPrompt, copied }: { purpose:string; setPurpose:(x:string)=>void; expression:string; setExpression:(x:string)=>void; setting:string; setSetting:(x:string)=>void; prompt:string; copyPrompt:()=>void; copied:boolean }) {
  const select = (label:string, value:string, setter:(x:string)=>void, options:string[]) => <label className="select-field"><span>{label}</span><select value={value} onChange={e=>setter(e.target.value)}>{options.map(x=><option key={x}>{x}</option>)}</select></label>;
  return <section className="deploy-layout"><div className="builder"><div className="panel-title"><span>RECIPE BUILDER</span><b>LIVE</b></div>{select("Content purpose",purpose,setPurpose,["Documentary portrait","Lifestyle / UGC","Product holding","Professional profile","Cinematic still"])}{select("Expression",expression,setExpression,["Neutral, direct","Warm half-smile","Focused at work","Open laughter","Quiet concern"])}{select("Setting & light",setting,setSetting,["Natural window light","Golden-hour exterior","Clean studio softbox","Overcast field light","Warm apartment interior"])}<label className="range"><span>Identity strength <b>0.82</b></span><input type="range" min="40" max="110" defaultValue="82"/></label></div><div className="prompt-output"><div className="panel-title"><span>ASSEMBLED PROMPT</span><b>SDXL / COMFYUI</b></div><pre>{prompt}</pre><div className="negative"><span>NEGATIVE</span><p>cartoon, illustration, duplicate person, distorted face, text, watermark, oversmoothed skin, identity drift</p></div><button className="primary" onClick={copyPrompt}>{copied ? "Copied ✓" : "Copy prompt"}</button><div className="recipe-meta"><span>1024 × 1024</span><span>DPM++ 2M Karras</span><span>28 steps</span><span>CFG 6.5</span></div></div><div className="acceptance"><div><small>ACCEPTANCE PROTOCOL</small><h3>64-image stress test</h3><p>10 seeds · 5 expressions · 5 angles · 3 lights · 3 wardrobes · full body · signature anchor</p></div><button>Start scorecard →</button></div></section>;
}

function Validate({ avatar }: { avatar: "Mara" | "Lila" }) {
  const mara = avatar === "Mara";
  const rows = [
    ["Facial identity", "Recognizable in ≥ 8 of 10 fixed-seed outputs", mara ? "8 / 10" : "No batch", mara ? "pass" : "blocked"],
    ["Age stability", "Apparent age remains within the canon band", mara ? "9 / 10" : "No batch", mara ? "pass" : "blocked"],
    ["Hair structure", "Length, texture, and color remain canonical", mara ? "7 / 10" : "No batch", mara ? "review" : "blocked"],
    ["Signature anchor", "Anchor is present when visible and not contradicted", mara ? "4 / 10" : "No batch", "fail"],
    ["Prompt compliance", "Requested expression, shot, and setting are honored", mara ? "8 / 10" : "No batch", mara ? "pass" : "blocked"],
  ];
  return <section className="validation-layout"><div className="validation-summary"><div className="panel-title"><span>ACCEPTANCE DECISION</span><b>EVIDENCE REQUIRED</b></div><div className={`decision ${mara ? "review" : "blocked"}`}><small>{mara ? "CONDITIONAL — NOT RELEASED" : "BLOCKED"}</small><h2>{mara ? "One critical failure remains" : "No validation batch exists"}</h2><p>{mara ? "Mara’s face is stable, but the silver temple streak fails the explicit anchor threshold. Release stays blocked until remediation and rerun." : "Complete References, Dataset, Train, and Create before starting an acceptance batch."}</p></div><div className="remediation"><span>ROUTED REMEDIATION</span><strong>{mara ? "Return to References + Train" : "Return to References"}</strong><p>{mara ? "Increase unobstructed anchor coverage, review captions, retrain as a new version, then rerun the same fixed-seed matrix." : "Build structural coverage before any score can be assigned."}</p></div></div><div className="rubric"><div className="panel-title"><span>EXPLAINABLE RUBRIC</span><b>{mara ? "BATCH AF-MV-001" : "NOT STARTED"}</b></div>{rows.map(([metric,rule,result,state])=><div className="rubric-row" key={metric}><span className={`evidence ${state}`}>{state === "pass" ? "✓" : state === "fail" ? "×" : "!"}</span><div><strong>{metric}</strong><p>{rule}</p></div><em>{result}</em></div>)}<div className="rubric-note"><b>No mystery composite score.</b><span>Every decision cites the threshold, observed batch, and affected files. Human review can override only with a recorded reason.</span></div><button className="primary" disabled>{mara ? "Prototype: record review" : "Validation unavailable"}</button></div></section>;
}

function Launch({ avatar }: { avatar: "Mara" | "Lila" }) {
  const mara = avatar === "Mara";
  const items = [["Visual identity specification",true],["Canonical reference set",true],["Curated dataset + manifest",mara],["Identity LoRA + model card",mara],["Acceptance-test report",false],["Provenance and consent record",true],["License map",true]] as const;
  return <section className="launch-revised"><div className="release-gate"><p className="eyebrow"><span/>RELEASE CONTROL</p><div className="blocked-mark">×</div><h2>Release blocked</h2><p>{mara ? "The signature-anchor validation failure must be repaired and the acceptance report signed before a package can be exported." : "Lila has no sealed dataset, trained model, or acceptance evidence."}</p><button className="primary" disabled>Export unavailable</button><small>Prototype interface · no package will be created</small></div><div className="release-checklist"><div className="panel-title"><span>RELEASE REQUIREMENTS</span><b>{items.filter(x=>x[1]).length} / {items.length} SATISFIED</b></div>{items.map(([name,ok])=><div className="release-row" key={name}><span className={ok ? "ready" : "missing"}>{ok ? "✓" : "·"}</span><strong>{name}</strong><em>{ok ? "Recorded" : "Required"}</em></div>)}<div className="integrity-note"><strong>The package inherits only verified rights.</strong><p>Original Foundry materials, client avatar assets, model weights, and third-party software remain separately identified. No blanket PLR claim crosses those boundaries.</p></div></div><div className="deferred-card"><small>DEFERRED UNTIL CORE LOOP WORKS</small><h3>Commercial expansion</h3><p>Pricing calculators, proposal generation, white-label variants, and elaborate monetization tools come after reliable creation, validation, and export.</p><div><span>Client pricing</span><b>Later</b></div><div><span>White-label toolkit</span><b>Later</b></div><div><span>Advanced controls</span><b>Later</b></div></div></section>;
}
