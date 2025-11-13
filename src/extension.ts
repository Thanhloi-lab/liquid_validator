import * as vscode from "vscode";
import { Liquid } from "liquidjs";
import * as fs from "fs";
import * as path from "path";
import { XMLParser } from "fast-xml-parser"; // Added for XML support

const engine = new Liquid();
const xmlParser = new XMLParser(); // Initialize parser once

// --- HELPER FUNCTIONS ---

function isQuoted(varName: string, template: string): boolean {
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
    const m = p.match(/^([a-zA-Z0-9_\.]+)\s*(==|!=)\s*(.+)$/);
    if (!m) {
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
    ctx[variable] = wantTrue ? 1 : "null";
    return ctx;
  }

  if (op === "==") {
    if (wantTrue) {
      ctx[variable] = rhsIsNull ? "null" : rhs;
    } else {
      if (rhsIsNull) ctx[variable] = "1";
      else if (typeof rhs === "number") ctx[variable] = rhs + 1;
      else ctx[variable] = String(rhs) + "_diff";
    }
    return ctx;
  }

  if (op === "!=") {
    if (wantTrue) {
      if (rhsIsNull) ctx[variable] = "1";
      else if (typeof rhs === "number") ctx[variable] = rhs + 1;
      else ctx[variable] = String(rhs) + "_diff";
    } else {
      ctx[variable] = rhsIsNull ? "null" : rhs;
    }
    return ctx;
  }

  return ctx;
}

function ctxForOrCondition(base: any, orConds: Cond[]): any {
  const [v, op, rhs] = orConds[0];
  return ctxForSimpleCondition(base, v, op, rhs, true);
}

/**
 * Centralized validation function.
 * Throws an error if the rendered content is invalid.
 */
function validateOutput(renderedText: string, formatType: "json" | "xml") {
  if (formatType === "json") {
    JSON.parse(renderedText); // Will throw if invalid JSON
  } else if (formatType === "xml") {
    xmlParser.parse(renderedText); // Will throw if invalid XML
  }
}

async function generateScenariosAndBadFiles(
  templateStr: string,
  docPath: string,
  formatType: "json" | "xml"
) {
  // collect vars
  const varRe = /{{\s*([a-zA-Z0-9_\.]+)\s*}}/g;
  const allVars = new Set<string>();
  let mm;
  while ((mm = varRe.exec(templateStr)) !== null) {
    allVars.add(mm[1]);
  }

  const baseCtx: any = {};
  for (const v of allVars) {
    if (isQuoted(v, templateStr)) baseCtx[v] = randomString();
    else baseCtx[v] = randomUnquoted();
  }

  // find if blocks
  const ifBlockRe = /{%\s*if\s+(.+?)\s*%}([\s\S]*?){%\s*endif\s*%}/g;
  const elsifRe = /{%\s*elsif\s+(.+?)\s*%}/g;

  // case/when
  const caseRe =
    /{%\s*case\s+([a-zA-Z0-9_\.]+)\s*%}([\s\S]*?){%\s*endcase\s*%}/g;
  const whenRe = /{%\s*when\s+([^%]+?)\s*%}/g;

  const scenarios: Array<[string, any]> = [
    ["base", JSON.parse(JSON.stringify(baseCtx))],
  ];

  // --- Scenario Generation Logic (unchanged) ---
  let ifMatch;
  while ((ifMatch = ifBlockRe.exec(templateStr)) !== null) {
    const firstCond = ifMatch[1].trim();
    const body = ifMatch[2];

    const orConds = parseOrCondition(firstCond);
    const ctxIf = ctxForOrCondition(baseCtx, orConds);
    scenarios.push([`if_${firstCond}`, ctxIf]);

    const elsifs = Array.from(body.matchAll(elsifRe));
    for (const em of elsifs) {
      const elsifCond = (em as any)[1].trim();
      const oc = parseOrCondition(elsifCond);
      const ctxElsif = ctxForOrCondition(baseCtx, oc);
      scenarios.push([`elsif_${elsifCond}`, ctxElsif]);
    }

    let ctxElse = JSON.parse(JSON.stringify(baseCtx));
    for (const [v, op, rhs] of orConds) {
      ctxElse = ctxForSimpleCondition(ctxElse, v, op, rhs, false);
    }
    for (const em of elsifs) {
      const elsifCond = (em as any)[1].trim();
      const oc = parseOrCondition(elsifCond);
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
      ctx[caseVar] = val;
      scenarios.push([`case_${caseVar}_${val}`, ctx]);
    }
  }

  // --- Output Directory Logic (Updated) ---
  const docDir = path.dirname(docPath);
  const docName = path.basename(docPath, path.extname(docPath));
  const outDir = path.join(docDir, `${docName}_fails`);
  const fileExtension = `.${formatType}`; // Dynamic file extension

  // Remove old _fails directory if it exists
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
      // rendering error => treat as bad
      rendered = String(e);
    }

    // Use new validateOutput function
    try {
      validateOutput(rendered, formatType);
      // ok
    } catch (e) {
      const safeName = name.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
      // Use dynamic fileExtension
      const filePath = path.join(outDir, `${safeName}${fileExtension}`);
      fs.writeFileSync(filePath, rendered, "utf8");
      badFiles.push(filePath);
    }
  }

  return { outDir, badFiles };
}

export function activate(context: vscode.ExtensionContext) {
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("liquid-check");
  context.subscriptions.push(diagnosticCollection);

  const disposable = vscode.commands.registerCommand(
    "liquidCheck.validate",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("Open a Liquid file first."); // Translated
        return;
      }

      // Ask user for format
      const formatType = (await vscode.window.showQuickPick(["json", "xml"], {
        placeHolder: "Select the format to validate", // Translated
      })) as "json" | "xml" | undefined;

      if (!formatType) {
        // User cancelled
        return;
      }

      const doc = editor.document;
      const text = doc.getText();
      const docPath = doc.uri.fsPath;

      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Validating Liquid ${formatType.toUpperCase()}...`, // Translated
          cancellable: false,
        },
        async (p) => {
          p.report({ message: "Generating scenarios..." }); // Translated
          try {
            // Pass formatType
            const { outDir, badFiles } = await generateScenariosAndBadFiles(
              text,
              docPath,
              formatType
            );

            diagnosticCollection.clear();

            if (badFiles.length === 0) {
              vscode.window.showInformationMessage(
                // Translated
                `All scenarios produced valid ${formatType.toUpperCase()} 🎉`
              );
              // Clean up _fails dir if no errors
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
                  // Translated
                  `Scenario ${name} produced invalid ${formatType.toUpperCase()}. See ${file}`,
                  vscode.DiagnosticSeverity.Error
                );
                diagnostics.push(diag);
              }
              diagnosticCollection.set(doc.uri, diagnostics);

              const open = "Open Failures Folder"; // Translated
              const res = await vscode.window.showErrorMessage(
                // Translated
                `${badFiles.length} failing scenarios. See folder: ${outDir}`,
                open
              );
              if (res === open) {
                const uri = vscode.Uri.file(outDir);
                // Open folder in a new window
                vscode.commands.executeCommand("vscode.openFolder", uri, {
                  forceNewWindow: true,
                });
              }
            }
          } catch (err: any) {
            vscode.window.showErrorMessage(
              // Translated
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

// VS Code handles disposal of 'diagnosticCollection'
// because we pushed it to context.subscriptions.
export function deactivate() {}