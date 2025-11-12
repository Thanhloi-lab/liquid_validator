# **Liquid Validator (JSON/XML)**

Một extension cho VS Code giúp kiểm tra các file template Liquid (.liquid) để đảm bảo rằng chúng *luôn luôn* render ra file JSON hoặc XML hợp lệ.

Extension này thực hiện điều này bằng cách tự động tạo ra nhiều "kịch bản" (scenarios) dựa trên các khối {% if %} và {% case %} trong code của bạn.

## **Tính năng**

* **Xác thực JSON & XML**: Chọn định dạng bạn cần xác thực.  
* **Tạo kịch bản tự động**: Phân tích logic if/elsif/else và case/when để tìm các nhánh code.  
* **Báo cáo lỗi chi tiết**: Nếu một kịch bản render ra file không hợp lệ, một thư mục \_fails sẽ được tạo ngay bên cạnh file của bạn, chứa chính xác output đã gây lỗi.  
* **Tích hợp mượt mà**: Chạy lệnh từ Command Palette, menu chuột phải, hoặc tự động khi lưu file.

## **Cách sử dụng**

1. Mở một file .liquid mà bạn muốn kiểm tra.  
2. Mở Command Palette (nhấn Ctrl+Shift+P hoặc Cmd+Shift+P).  
3. Tìm và chạy lệnh: **"Liquid: Validate JSON/XML Output"**.  
4. Bạn cũng có thể **chuột phải** vào trình soạn thảo và chọn lệnh từ menu.  
5. Extension cũng sẽ tự động chạy **khi bạn lưu** file .liquid.

Nếu có lỗi, một thông báo sẽ xuất hiện và các lỗi sẽ được đánh dấu trong tab "Problems".

## **Yêu cầu**

Không có yêu cầu đặc biệt. Các thư viện liquidjs và fast-xml-parser đã được đi kèm trong extension.

**Chúc bạn code vui vẻ\!**