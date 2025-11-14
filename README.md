# **Liquid Validator (JSON/XML)**

A VS Code extension that validates Liquid template files (.liquid) to ensure they *always* render valid JSON or XML.

This extension provides two core features: **Validation** (checking for errors) and **Syntax Highlighting** (coloring your code).

## **Features**

* **Rich Syntax Highlighting**:  
  * Provides context-aware coloring for .liquid files.  
  * Automatically detects and colors JSON, XML, or HTML content.  
  * Differentiates between logic tags ({% %}), output variables ({{ }}), and the variables inside them for maximum readability.  
* **JSON & XML Validation**: Choose which format you need to validate.  
* **Automatic Scenario Generation**: Analyzes if/elsif/else and case/when logic to find all code paths.  
* **Complex Variable Support**: Understands nested variables like request.primary\_name and request\[0\].name during validation.  
* **Detailed Error Reporting**: If a scenario renders invalid output, a \_fails directory is created next to your file, containing the exact broken output.  
* **Smooth Integration**: Run from the Command Palette, editor context menu (right-click), or automatically on save.

## **Usage**

### **Syntax Highlighting**

This feature activates automatically when you open any .liquid file.

### **Validation**

1. Open a .liquid file you want to check.  
2. Open the Command Palette (Ctrl+Shift+P or Cmd+Shift+P).  
3. Find and run the command: **"Liquid: Validate JSON/XML Output"**.  
4. You can also **right-click** in the editor and select the command from the context menu.  
5. The extension will also run **automatically when you save** a .liquid file.

If errors are found, a notification will appear, and diagnostics will be added to the "Problems" tab.

## **Requirements**

None. The liquidjs and fast-xml-parser libraries are bundled with the extension.

**Happy coding\!**