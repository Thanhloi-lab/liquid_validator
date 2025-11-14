# **Change Log**

All notable changes to the "liquid-validator" extension will be documented in this file.

## **\[0.1.2\] \- 2025-11-13**

### **Added**

* **Syntax Highlighting\!** The extension now provides rich syntax highlighting for .liquid files.  
* **Context-Aware Coloring**: Automatically detects if your template is primarily JSON, XML, or HTML and colors it accordingly.  
* **Smart Color Distinction**:  
  * {% ... %} tags (logic) are colored differently (e.g., purple).  
  * {{ ... }} variables (output) are colored differently (e.g., orange).  
  * Variables inside logic blocks (if user.name) have a different color (e.g., green) than variables in output blocks ({{ user.name }}), making code much easier to read.  
* Added language configuration for auto-closing pairs ({% %}, {{ }}) and indentation.

### **Changed**

* Updated core logic to support complex nested variables like request\[0\].primary\_name during validation.