#!/usr/bin/env node

const request = process.argv.slice(2).join(" ").trim();

if (!request) {
  console.error("Usage: map_intent.mjs <natural language request>");
  process.exit(2);
}

const text = request.toLowerCase();

const ACTIONS = [
  {
    intent: "audit",
    mcpTool: "surface_audit",
    needsTarget: true,
    words: ["audit", "review", "check", "inspect"],
  },
  {
    intent: "capture",
    mcpTool: "surface_capture",
    needsTarget: true,
    words: ["capture", "snapshot", "screenshot"],
  },
  {
    intent: "explain",
    mcpTool: "surface_explain",
    needsId: true,
    words: ["explain", "why"],
  },
  {
    intent: "backlog",
    mcpTool: "surface_backlog",
    words: ["backlog", "tracked finding", "tracked findings", "tasks"],
  },
  {
    intent: "validate",
    mcpTool: "surface_validate",
    needsId: true,
    words: ["validate"],
  },
  {
    intent: "gate",
    mcpTool: "surface_gate",
    words: ["gate", "ci", "release"],
  },
  {
    intent: "trace",
    mcpTool: "surface_trace",
    needsId: true,
    words: ["trace"],
  },
  {
    intent: "run",
    mcpTool: "surface_run",
    needsTarget: true,
    words: ["run", "closed loop", "closed-loop"],
  },
  {
    intent: "next",
    mcpTool: "surface_next",
    words: ["next", "next action", "next task"],
  },
  {
    intent: "status",
    mcpTool: "surface_status",
    words: ["status", "progress"],
  },
  {
    intent: "init",
    mcpTool: "surface_run",
    words: ["init", "initialize", "setup", "set up"],
  },
];

const action = ACTIONS.find((candidate) => candidate.words.some((word) => hasWord(text, word)));

if (!action) {
  print({
    needsClarification: true,
    question:
      "Which Surface action should I map this to: audit, capture, explain, backlog, validate, gate, trace, run, next, status, or init?",
    request,
  });
  process.exit(0);
}

const target = action.needsTarget ? extractTarget(request) : undefined;

if (action.needsTarget && !target) {
  print({
    intent: action.intent,
    mcpTool: action.mcpTool,
    needsClarification: true,
    question: `What target should Surface ${action.intent}: a URL, localhost app, route, component, DOM snippet, or screenshot?`,
    request,
  });
  process.exit(0);
}

const id = action.needsId ? extractId(request, action.intent) : undefined;

if (action.needsId && !id) {
  print({
    intent: action.intent,
    mcpTool: action.mcpTool,
    needsClarification: true,
    question: `What ${action.intent === "validate" ? "run" : "finding"} id should Surface ${action.intent}?`,
    request,
  });
  process.exit(0);
}

const command = buildCommand(action.intent, target, id);
const targetLabel = target?.ref ?? id;
const confirmation = `Mapped intent to surface ${action.intent}${targetLabel ? ` for ${targetLabel}` : ""}. Confirm before running: ${shellJoin(command)}`;

print({
  command,
  confirmation,
  intent: action.intent,
  mcpTool: action.mcpTool,
  ...(target ? { target } : {}),
  transport: "cli",
});

function extractTarget(value) {
  const url = value.match(/https?:\/\/[^\s"'<>),]+/i)?.[0];
  if (url) {
    return {
      kind: /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(url)
        ? "localhost"
        : "url",
      ref: url,
    };
  }

  const route = value.match(/\s(\/[A-Za-z0-9._~!$&'()*+,;=:@/-]+)/)?.[1];
  if (route) {
    return { kind: "route", ref: route };
  }

  const screenshot = value.match(/\b([^\s]+\.(?:png|jpe?g|webp))\b/i)?.[1];
  if (screenshot) {
    return { kind: "screenshot", ref: screenshot };
  }

  const component = value.match(/\bcomponent\s+([A-Za-z][A-Za-z0-9_.:-]*)/i)?.[1];
  if (component) {
    return { kind: "component", ref: component };
  }

  if (/<[a-z][\s\S]*>/i.test(value) || /\bdom\b/i.test(value)) {
    return { kind: "dom", ref: value };
  }

  return undefined;
}

function hasWord(value, word) {
  const pattern = word
    .split(/\s+/)
    .map((part) => escapeRegExp(part))
    .join("\\s+");
  return new RegExp(`\\b${pattern}\\b`, "i").test(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractId(value, intent) {
  const preferred =
    intent === "validate"
      ? value.match(/\b(run[_:-]?[A-Za-z0-9._-]+)\b/i)?.[1]
      : value.match(/\b(finding[_:-]?[A-Za-z0-9._-]+)\b/i)?.[1];
  if (preferred) {
    return preferred;
  }

  return value.match(/\b[A-Za-z]+-[A-Za-z0-9._-]+\b/)?.[0];
}

function buildCommand(intent, target, id) {
  if (target) {
    return ["surface", intent, `--${target.kind}`, target.ref, "--json"];
  }

  switch (intent) {
    case "explain":
    case "trace":
      return ["surface", intent, id, "--json"];
    case "validate":
      return ["surface", "validate", "--run", id, "--json"];
    case "gate":
      return ["surface", "gate", "--ci", "--json"];
    case "init":
      return ["surface", "init", "--json"];
    default:
      return ["surface", intent, "--json"];
  }
}

function shellJoin(parts) {
  return parts
    .map((part) => (/^[A-Za-z0-9_./:=@-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(" ");
}

function print(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
