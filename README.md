# **Liquid Validator (JSON/XML)**

A VS Code extension that validates Liquid template files (.liquid) to ensure they *always* render valid JSON or XML.

This extension works by automatically generating multiple "scenarios" based on the {% if %} and {% case %} blocks in your code.

## **Features**

* **JSON & XML Validation**: Choose which format you need to validate.  
* **Automatic Scenario Generation**: Analyzes if/elsif/else and case/when logic to find all code paths.  
* **Detailed Error Reporting**: If a scenario renders invalid output, a \_fails directory is created next to your file, containing the exact broken output.  
* **Smooth Integration**: Run from the Command Palette, editor context menu (right-click), or automatically on save.

## **Usage**

1. Open a .liquid file you want to check.  
2. Open the Command Palette (Ctrl+Shift+P or Cmd+Shift+P).  
3. Find and run the command: **"Liquid: Validate JSON/XML Output"**.  
4. You can also **right-click** in the editor and select the command from the context menu.  
5. The extension will also run **automatically when you save** a .liquid file.

If errors are found, a notification will appear, and diagnostics will be added to the "Problems" tab.

## **Requirements**

None. The liquidjs and fast-xml-parser libraries are bundled with the extension.

**Happy coding\!**