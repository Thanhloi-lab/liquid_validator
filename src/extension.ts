import * as vscode from "vscode";
import { Liquid } from "liquidjs";
import * as fs from "fs";
import * as path from "path";
import { XMLParser } from "fast-xml-parser";

const engine = new Liquid();
const xmlParser = new XMLParser();

// --- HELPER FUNCTIONS ---

/**
 * NEW: Deeply sets a value in an object based on a path string.
 * Handles paths like "a.b", "a[0].c", or "a.b[0][1].d".
 */
function setDeep(obj: any, pathStr: string, value: any) {
  // Convert "a.b[0].c" into ["a", "b", "0", "c"]
  const path = pathStr.replace(/\[/g, ".").replace(/\]/g, "").split(".").filter(Boolean);

  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];

    if (current[key] === undefined || current[key] === null) {
      // Look ahead to see if the next key is a number
      const nextKey = path[i + 1];
      if (!isNaN(Number(nextKey))) {
        current[key] = []; // It's an array
      } else {
        current[key] = {}; // It's an object
      }
    }
    current = current[key];
  }

  // Set the final value
  current[path[path.length - 1]] = value;
  return obj;
}

function isQuoted(varName: string, template: string): boolean {
  // This regex can remain simple, it just checks for quotes *around* the variable
  const re = new RegExp(`["']\\s*{{\\s*${varName}\\s*}}\\s*["']`);
  return re.test(template);
}

function randomString(): string {
  return "str_" + Math.floor(Math.random() * 9000 + 1000);
}

function randomUnquoted(): string {
  const kinds = ["null", "number", "bool"];
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  if (kind === "null") return "null";
  if (kind === "number") return String(Math.floor(Math.random() * 100));
  return Math.random() > 0.5 ? "true" : "false";
}

type Cond = [string, string | null, string | number | null];

function parseOrCondition(condText: string): Cond[] {
  const parts = condText.split(" or ").map((s) => s.trim());
  const conds: Cond[] = [];
  for (const p of parts) {
    // UPDATED REGEX: Allow [ and ] in the variable name
    const m = p.match(/^([a-zA-Z0-9_\.\[\]'"]+)\s*(==|!=)\s*(.+)$/);
    if (!m) {
      // Simple truthy check, e.g., {% if variable %}
      conds.push([p.trim(), null, null]);
    } else {
      let [, v, op, rhsRaw] = m;
      let rhs: string | number = rhsRaw.trim();
      if (
        (rhs.startsWith('"') && rhs.endsWith('"')) ||
        (rhs.startsWith("'") && rhs.endsWith("'"))
      ) {
        rhs = rhs.slice(1, -1);
      } else if (!Number.isNaN(Number(rhs))) {
        rhs = Number(rhs);
      }
      conds.push([v, op as string, rhs]);
    }
  }
  return conds;
}

function ctxForSimpleCondition(
  base: any,
  variable: string,
  op: string | null,
  rhs: any,
  wantTrue = true
): any {
  const ctx = JSON.parse(JSON.stringify(base)); // deep clone
  const rhsIsNull =
    rhs === null ||
    (typeof rhs === "string" && (rhs as string).toLowerCase() === "null");

  if (!op) {
    // {% if variable %}
    // UPDATED: Use setDeep to set the value
    setDeep(ctx, variable, wantTrue ? 1 : "null");
    return ctx;
  }

  if (op === "==") {
    if (wantTrue) {
      setDeep(ctx, variable, rhsIsNull ? "null" : rhs);
    } else {
      let failValue: any;
      if (rhsIsNull) failValue = "1";
      else if (typeof rhs === "number") failValue = rhs + 1;
      else failValue = String(rhs) + "_diff";
      setDeep(ctx, variable, failValue);
    }
    return ctx;
  }

  if (op === "!=") {
    if (wantTrue) {
      let successValue: any;
      if (rhsIsNull) successValue = "1";
      else if (typeof rhs === "number") successValue = rhs + 1;
      else successValue = String(rhs) + "_diff";
      setDeep(ctx, variable, successValue);
    } else {
      setDeep(ctx, variable, rhsIsNull ? "null" : rhs);
    }
    return ctx;
  }

  return ctx;
}

function ctxForOrCondition(base: any, orConds: Cond[]): any {
  const [v, op, rhs] = orConds[0];
  return ctxForSimpleCondition(base, v, op, rhs, true);
}

function validateOutput(renderedText: string, formatType: "json" | "xml") {
  if (formatType === "json") {
    JSON.parse(renderedText);
  } else if (formatType === "xml") {
    xmlParser.parse(renderedText);
  }
}

async function generateScenariosAndBadFiles(
  templateStr: string,
  docPath: string,
  formatType: "json" | "xml"
) {
  // collect vars
  // UPDATED REGEX: Allow [ and ] to find paths like request[0].name
  const varRe = /{{\s*([a-zA-Z0-9_\.\[\]'"]+)\s*}}/g;
  const allVars = new Set<string>();
  let mm;
  while ((mm = varRe.exec(templateStr)) !== null) {
    // Avoid capturing filters or other liquid logic
    if (mm[1] && !mm[1].includes("|")) {
      allVars.add(mm[1]);
    }
  }

  const baseCtx: any = {};
  for (const v of allVars) {
    const value = isQuoted(v, templateStr) ? randomString() : randomUnquoted();
    // UPDATED: Use setDeep to build a nested context
    setDeep(baseCtx, v, value);
  }

  // find if blocks
  const ifBlockRe = /{%\s*if\s+(.+?)\s*%}([\s\S]*?){%\s*endif\s*%}/g;
  const elsifRe = /{%\s*elsif\s+(.+?)\s*%}/g;

  // case/when
  // UPDATED REGEX: Allow [ and ] in case variable
  const caseRe =
    /{%\s*case\s+([a-zA-Z0-9_\.\[\]'"]+)\s*%}([\s\S]*?){%\s*endcase\s*%}/g;
  const whenRe = /{%\s*when\s+([^%]+?)\s*%}/g;

  const scenarios: Array<[string, any]> = [
    ["base", JSON.parse(JSON.stringify(baseCtx))],
  ];

  // --- Scenario Generation Logic ---
  let ifMatch;
  while ((ifMatch = ifBlockRe.exec(templateStr)) !== null) {
    const firstCond = ifMatch[1].trim();
    const body = ifMatch[2];

    const orConds = parseOrCondition(firstCond);
    if (orConds.length === 0) continue; // Skip if parsing failed

    const ctxIf = ctxForOrCondition(baseCtx, orConds);
    scenarios.push([`if_${firstCond}`, ctxIf]);

    const elsifs = Array.from(body.matchAll(elsifRe));
    for (const em of elsifs) {
      const elsifCond = (em as any)[1].trim();
      const oc = parseOrCondition(elsifCond);
      if (oc.length === 0) continue;
      const ctxElsif = ctxForOrCondition(baseCtx, oc);
      scenarios.push([`elsif_${elsifCond}`, ctxElsif]);
    }

    // else: make all false
    let ctxElse = JSON.parse(JSON.stringify(baseCtx));
    for (const [v, op, rhs] of orConds) {
      ctxElse = ctxForSimpleCondition(ctxElse, v, op, rhs, false);
    }
    for (const em of elsifs) {
      const elsifCond = (em as any)[1].trim();
      const oc = parseOrCondition(elsifCond);
      if (oc.length === 0) continue;
      for (const [v, op, rhs] of oc) {
        ctxElse = ctxForSimpleCondition(ctxElse, v, op, rhs, false);
      }
    }
    scenarios.push([`else_of_${firstCond}`, ctxElse]);
  }

  let caseMatch;
  while ((caseMatch = caseRe.exec(templateStr)) !== null) {
    const caseVar = (caseMatch as any)[1].trim();
    const block = (caseMatch as any)[2];
    const whens = Array.from(block.matchAll(whenRe));
    for (const w of whens) {
      let val: any = (w as any)[1].trim().replace(/^['"]|['"]$/g, "");
      if (!Number.isNaN(Number(val))) val = Number(val);
      
      const ctx = JSON.parse(JSON.stringify(baseCtx));
      // UPDATED: Use setDeep to set the case variable
      setDeep(ctx, caseVar, val);
      scenarios.push([`case_${caseVar}_${val}`, ctx]);
    }
  }

  // --- Output Directory Logic ---
  const docDir = path.dirname(docPath);
  const docName = path.basename(docPath, path.extname(docPath));
  const outDir = path.join(docDir, `${docName}_fails`);
  const fileExtension = `.${formatType}`;

  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  const badFiles: string[] = [];

  for (const [name, ctx] of scenarios) {
    let rendered = "";
    try {
      const tpl = engine.parse(templateStr);
      rendered = await engine.render(tpl, ctx);
    } catch (e) {
      rendered = String(e);
    }

    try {
      validateOutput(rendered, formatType);
    } catch (e) {
      const safeName = name.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
      const filePath = path.join(outDir, `${safeName}${fileExtension}`);
      fs.writeFileSync(filePath, rendered, "utf8");
      badFiles.push(filePath);
    }
  }

  return { outDir, badFiles };
}

// --- activate and deactivate functions (no changes needed) ---
// (The main logic for activation, UI, and progress remains the same)

export function activate(context: vscode.ExtensionContext) {
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("liquid-check");
  context.subscriptions.push(diagnosticCollection);

  const disposable = vscode.commands.registerCommand(
    "liquidCheck.validate",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("Open a Liquid file first.");
        return;
      }

      const formatType = (await vscode.window.showQuickPick(["json", "xml"], {
        placeHolder: "Select the format to validate",
      })) as "json" | "xml" | undefined;

      if (!formatType) {
        return;
      }

      const doc = editor.document;
      const text = doc.getText();
      const docPath = doc.uri.fsPath;

      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Validating Liquid ${formatType.toUpperCase()}...`,
          cancellable: false,
        },
        async (p) => {
          p.report({ message: "Generating scenarios..." });
          try {
            const { outDir, badFiles } = await generateScenariosAndBadFiles(
              text,
              docPath,
              formatType
            );

            diagnosticCollection.clear();

            if (badFiles.length === 0) {
              vscode.window.showInformationMessage(
                `All scenarios produced valid ${formatType.toUpperCase()} 🎉`
              );
              if (fs.existsSync(outDir)) {
                fs.rmSync(outDir, { recursive: true, force: true });
              }
            } else {
              const diagnostics: vscode.Diagnostic[] = [];
              const fileExtension = `.${formatType}`;

              for (let i = 0; i < badFiles.length; i++) {
                const file = badFiles[i];
                const name = path.basename(file, fileExtension);
                const range = new vscode.Range(0, 0, 0, 1);
                const diag = new vscode.Diagnostic(
                  range,
                  `Scenario ${name} produced invalid ${formatType.toUpperCase()}. See ${file}`,
                  vscode.DiagnosticSeverity.Error
                );
                diagnostics.push(diag);
              }
              diagnosticCollection.set(doc.uri, diagnostics);

              const open = "Open Failures Folder";
              const res = await vscode.window.showErrorMessage(
                `${badFiles.length} failing scenarios. See folder: ${outDir}`,
                open
              );
              if (res === open) {
                const uri = vscode.Uri.file(outDir);
                vscode.commands.executeCommand("vscode.openFolder", uri, {
                  forceNewWindow: true,
                });
              }
            }
          } catch (err: any) {
            vscode.window.showErrorMessage(
              "Error validating Liquid: " + String(err)
            );
          }
        }
      );
    }
  );

  context.subscriptions.push(disposable);

  // optional: validate on save
  vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.languageId === "liquid" || doc.fileName.endsWith(".liquid")) {
      vscode.commands.executeCommand("liquidCheck.validate");
    }
  });
}

export function deactivate() {}