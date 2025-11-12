import * as vscode from "vscode";
import { Liquid } from "liquidjs";
import * as fs from "fs";
import * as path from "path";
import { XMLParser } from "fast-xml-parser"; // <- THÊM: Hỗ trợ XML

const engine = new Liquid();
const xmlParser = new XMLParser(); // <- THÊM: Khởi tạo 1 lần

// --- CÁC HÀM HELPER (Tương tự file TS cũ) ---

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
 * THÊM: Hàm xác thực (validate) tập trung
 * Ném ra lỗi nếu nội dung render không hợp lệ.
 */
function validateOutput(renderedText: string, formatType: "json" | "xml") {
  if (formatType === "json") {
    JSON.parse(renderedText); // Sẽ ném ra lỗi nếu JSON không hợp lệ
  } else if (formatType === "xml") {
    xmlParser.parse(renderedText); // Sẽ ném ra lỗi nếu XML không hợp lệ
  }
}

async function generateScenariosAndBadFiles(
  templateStr: string,
  docPath: string,
  formatType: "json" | "xml" // <- THAY ĐỔI: Nhận định dạng
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

  // --- Logic tạo Scenario (như cũ) ---
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

  // --- Logic thư mục Output (ĐÃ CẬP NHẬT) ---
  const docDir = path.dirname(docPath);
  const docName = path.basename(docPath, path.extname(docPath));
  const outDir = path.join(docDir, `${docName}_fails`);
  const fileExtension = `.${formatType}`; // <- THAY ĐỔI: Dùng đuôi file động

  // THAY ĐỔI: Xóa thư mục _fails cũ nếu tồn tại
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
    console.log(`Đã xóa thư mục '${outDir}' cũ.`);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const badFiles: string[] = [];

  for (const [name, ctx] of scenarios) {
    let rendered = "";
    try {
      const tpl = engine.parse(templateStr);
      rendered = await engine.render(tpl, ctx);
    } catch (e) {
      // lỗi render => cũng là lỗi
      rendered = String(e);
    }

    // THAY ĐỔI: Dùng hàm validateOutput mới
    try {
      validateOutput(rendered, formatType);
      // ok
    } catch (e) {
      const safeName = name.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
      // THAY ĐỔI: Dùng fileExtension động
      const filePath = path.join(outDir, `${safeName}${fileExtension}`);
      fs.writeFileSync(filePath, rendered, "utf8");
      badFiles.push(filePath);
    }
  }

  // Logic zip đã bị xóa, chỉ trả về outDir và badFiles
  return { outDir, badFiles };
}

export function activate(context: vscode.ExtensionContext) {
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("liquid-json-check");
  context.subscriptions.push(diagnosticCollection);

  const disposable = vscode.commands.registerCommand(
    "liquidJsonCheck.validate",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("Mở một file Liquid trước.");
        return;
      }

      // THAY ĐỔI: Hỏi người dùng định dạng
      const formatType = (await vscode.window.showQuickPick(["json", "xml"], {
        placeHolder: "Chọn định dạng để xác thực",
      })) as "json" | "xml" | undefined;

      if (!formatType) {
        // Người dùng đã hủy
        return;
      }

      const doc = editor.document;
      const text = doc.getText();
      const docPath = doc.uri.fsPath;

      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Đang xác thực Liquid ${formatType.toUpperCase()}...`,
          cancellable: false,
        },
        async (p) => {
          p.report({ message: "Đang tạo các kịch bản..." });
          try {
            // THAY ĐỔI: Truyền formatType vào
            const { outDir, badFiles } = await generateScenariosAndBadFiles(
              text,
              docPath,
              formatType
            );

            diagnosticCollection.clear();

            if (badFiles.length === 0) {
              vscode.window.showInformationMessage(
                // THAY ĐỔI: Hiển thị thông báo động
                `Tất cả kịch bản đều tạo ra ${formatType.toUpperCase()} hợp lệ 🎉`
              );
              // THAY ĐỔI: Xóa thư mục _fails nếu không có lỗi
              if (fs.existsSync(outDir)) {
                fs.rmSync(outDir, { recursive: true, force: true });
              }
            } else {
              const diagnostics: vscode.Diagnostic[] = [];
              const fileExtension = `.${formatType}`; // <- THAY ĐỔI

              for (let i = 0; i < badFiles.length; i++) {
                const file = badFiles[i];
                // THAY ĐỔI: Dùng fileExtension động
                const name = path.basename(file, fileExtension);
                const range = new vscode.Range(0, 0, 0, 1);
                const diag = new vscode.Diagnostic(
                  range,
                  // THAY ĐỔI: Hiển thị thông báo động
                  `Kịch bản ${name} tạo ra ${formatType.toUpperCase()} không hợp lệ. Xem ${file}`,
                  vscode.DiagnosticSeverity.Error
                );
                diagnostics.push(diag);
              }
              diagnosticCollection.set(doc.uri, diagnostics);

              const open = "Mở thư mục lỗi";
              const res = await vscode.window.showErrorMessage(
                `${badFiles.length} kịch bản lỗi. Xem thư mục: ${outDir}`,
                open
              );
              if (res === open) {
                const uri = vscode.Uri.file(outDir);
                // Mở thư mục trong VS Code
                vscode.commands.executeCommand("vscode.openFolder", uri, {
                  forceNewWindow: true, // Mở cửa sổ mới để không làm phiền cửa sổ hiện tại
                });
              }
            }
          } catch (err: any) {
            vscode.window.showErrorMessage(
              "Lỗi khi xác thực Liquid: " + String(err)
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
      vscode.commands.executeCommand("liquidJsonCheck.validate");
    }
  });
}

export function deactivate() {
  // Xóa diagnostics khi tắt
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("liquid-json-check");
  diagnosticCollection.clear();
  diagnosticCollection.dispose();
}