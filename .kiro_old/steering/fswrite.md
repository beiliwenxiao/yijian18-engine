---
inclusion: always
---
## 文件写入最佳实践

### fsWrite 和 fsAppend 使用指南

虽然 fsWrite 没有严格的行数限制，但为了确保稳定性和可靠性，建议根据文件大小选择不同的写入策略：

#### 小文件（< 200 行）
- **推荐方式**：直接使用 `fsWrite` 一次性写入
- **适用场景**：大多数 JavaScript 类文件、配置文件、小型测试文件
- **示例**：
  ```javascript
  fsWrite('src/MyClass.js', '完整的类代码...');
  ```

#### 中等文件（200-500 行）
- **推荐方式**：优先尝试 `fsWrite` 一次性写入，如遇问题则改用分段写入
- **适用场景**：较大的类文件、中型测试页面
- **示例**：
  ```javascript
  // 方式1：一次性写入（优先）
  fsWrite('test/test-page.html', '完整的HTML内容...');
  
  // 方式2：如果失败，分段写入
  fsWrite('test/test-page.html', 'HTML头部和样式...');
  fsAppend('test/test-page.html', 'HTML主体内容...');
  ```

#### 大文件（> 500 行）
- **推荐方式**：分 2-3 段写入，使用 `fsAppend` 追加
- **适用场景**：大型测试页面、复杂的 HTML 文件、长文档
- **示例**：
  ```javascript
  // 第一段：文件头部
  fsWrite('test/large-test.html', `
    <!DOCTYPE html>
    <html>
    <head>
      <style>/* CSS样式 */</style>
    </head>
    <body>
  `);
  
  // 第二段：HTML内容
  fsAppend('test/large-test.html', `
    <div class="container">
      <!-- HTML内容 -->
    </div>
  `);
  
  // 第三段：JavaScript和结束标签
  fsAppend('test/large-test.html', `
    <script type="module">
      // JavaScript代码
    </script>
    </body>
    </html>
  `);
  ```

### 分段写入的优势
1. **避免网络传输超时**：大文件一次性传输可能超时
2. **提高成功率**：减少因系统缓冲区限制导致的失败
3. **便于调试**：如果某段写入失败，容易定位问题
4. **更好的可维护性**：代码结构更清晰

### 注意事项
- 使用 `fsWrite` 会覆盖已存在的文件
- 使用 `fsAppend` 会在文件末尾追加内容
- 分段写入时注意保持代码的完整性（不要在函数或标签中间截断）
- 对于 HTML 文件，建议按照逻辑结构分段（head、body、script）
