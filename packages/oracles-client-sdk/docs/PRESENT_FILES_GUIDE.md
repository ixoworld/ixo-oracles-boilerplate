# Present Files Tool Guide

Complete guide to using the `present_files` AGUI tool for displaying artifacts and files with rich previews.

## Table of Contents

- [Overview](#overview)
- [Frontend Setup](#frontend-setup)
- [Backend/Agent Usage](#backendagent-usage)
- [Supported File Types](#supported-file-types)
- [Custom Preview Component](#custom-preview-component)
- [Examples](#examples)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Overview

The `present_files` tool allows AI oracles to present files and artifacts to users with rich, interactive previews. It's designed to work seamlessly with the skills-agent workflow where files are created in `/workspace/output/` and need to be displayed to the user.

**Key Features:**

- 📄 **PDF Preview** - Embedded viewer with download option
- 🖼️ **Image Display** - Inline preview for all common image formats
- 📊 **Office Files** - Download links with appropriate icons (Excel, Word, PowerPoint)
- 🌐 **HTML Preview** - Sandboxed iframe rendering
- 📝 **Text Files** - Syntax-highlighted preview
- 🎵 **Media Files** - Audio and video player support
- 📦 **Archives** - Download support for zip, tar, etc.
- 🔒 **Secure** - Sandboxed previews for HTML content

---

## Frontend Setup

### Basic Usage

Register the action in your chat interface:

```tsx
import { usePresentFilesAction, useChat } from '@ixo/oracles-client-sdk';

function ChatInterface() {
  // Register the present_files action
  usePresentFilesAction();

  // Use chat as normal
  const { messages, sendMessage } = useChat({
    oracleDid: 'your-oracle-did',
    sessionId: 'session-id',
    onPaymentRequiredError: handlePayment,
  });

  return (
    <div className="chat-interface">
      {messages.map((msg) => (
        <Message key={msg.id} message={msg} />
      ))}
      <MessageInput onSend={sendMessage} />
    </div>
  );
}
```

### With Custom Preview Component

You can provide a custom `ArtifactPreview` component:

```tsx
import {
  usePresentFilesAction,
  ArtifactPreview,
} from '@ixo/oracles-client-sdk';

// Option 1: Use the built-in component directly
function ChatInterface() {
  usePresentFilesAction(ArtifactPreview);
  // ... rest of your code
}

// Option 2: Create a custom component
import type { ArtifactPreviewProps } from '@ixo/oracles-client-sdk';

function CustomArtifactPreview({ title, fileType, url }: ArtifactPreviewProps) {
  return (
    <div className="my-custom-preview">
      <h2>{title}</h2>
      {/* Your custom rendering logic */}
    </div>
  );
}

function ChatInterface() {
  usePresentFilesAction(CustomArtifactPreview);
  // ... rest of your code
}
```

---

## Backend/Agent Usage

Once registered on the frontend, the skills-agent (or any agent) can use the `present_files` tool:

### Basic Tool Call

```typescript
// In your LangGraph agent or tool
present_files({
  title: 'Q4 Financial Report',
  fileType: 'pdf',
  artifactUrl: '/workspace/output/q4_report.pdf',
});
```

### From Skills Agent

The skills-agent automatically has access to this tool. After creating an artifact:

```python
# 1. Create artifact in /workspace/output/
create_pdf_report('/workspace/output/report.pdf')

# 2. Present it to user
present_files({
  "title": "Sales Analysis Report",
  "fileType": "pdf",
  "artifactUrl": "/workspace/output/report.pdf"
})
```

---

## Supported File Types

### Documents

| File Type          | Extension       | Preview Type    |
| ------------------ | --------------- | --------------- |
| PDF                | `.pdf`          | Embedded iframe |
| Word Documents     | `.doc`, `.docx` | Download link   |
| Excel Spreadsheets | `.xls`, `.xlsx` | Download link   |
| PowerPoint         | `.ppt`, `.pptx` | Download link   |
| OpenDocument       | `.odt`, `.ods`  | Download link   |

### Images

| File Type | Extension                                     | Preview Type   |
| --------- | --------------------------------------------- | -------------- |
| Images    | `.png`, `.jpg`, `.gif`, `.svg`, `.webp`, etc. | Inline display |

### Web & Text

| File Type  | Extension                          | Preview Type           |
| ---------- | ---------------------------------- | ---------------------- |
| HTML       | `.html`, `.htm`                    | Sandboxed iframe       |
| Text Files | `.txt`, `.md`, `.json`, `.csv`     | Text preview iframe    |
| Code Files | `.js`, `.ts`, `.py`, `.yaml`, etc. | Monospace text preview |

### Media

| File Type | Extension                      | Preview Type       |
| --------- | ------------------------------ | ------------------ |
| Video     | `.mp4`, `.webm`, `.mov`        | HTML5 video player |
| Audio     | `.mp3`, `.wav`, `.ogg`, `.m4a` | HTML5 audio player |

### Archives

| File Type | Extension                   | Preview Type  |
| --------- | --------------------------- | ------------- |
| Archives  | `.zip`, `.tar`, `.gz`, etc. | Download link |

---

## Custom Preview Component

Create your own preview component with custom styling and behavior:

```tsx
import React from 'react';
import type { ArtifactPreviewProps } from '@ixo/oracles-client-sdk';

export function MyArtifactPreview({
  title,
  fileType,
  url,
}: ArtifactPreviewProps) {
  const normalizedType = fileType.toLowerCase().replace(/^\./, '');

  // PDF preview
  if (normalizedType === 'pdf') {
    return (
      <div className="pdf-preview">
        <h3>{title}</h3>
        <iframe src={url} width="100%" height="800px" />
        <a href={url} download>
          Download PDF
        </a>
      </div>
    );
  }

  // Image preview
  if (['png', 'jpg', 'jpeg', 'gif'].includes(normalizedType)) {
    return (
      <div className="image-preview">
        <h3>{title}</h3>
        <img src={url} alt={title} style={{ maxWidth: '100%' }} />
      </div>
    );
  }

  // Default
  return (
    <div className="default-preview">
      <h3>{title}</h3>
      <p>File type: {fileType}</p>
      <a href={url} download>
        Download File
      </a>
    </div>
  );
}
```

Then register it:

```tsx
import { usePresentFilesAction } from '@ixo/oracles-client-sdk';
import { MyArtifactPreview } from './MyArtifactPreview';

function ChatInterface() {
  usePresentFilesAction(MyArtifactPreview);
  // ...
}
```

---

## Examples

### Example 1: PDF Report

```typescript
// After creating a PDF in the skills-agent
present_files({
  title: 'Monthly Financial Report - December 2024',
  fileType: 'pdf',
  artifactUrl: '/workspace/output/december_report.pdf',
});
```

**Result:** User sees an embedded PDF viewer with download button.

### Example 2: Excel Spreadsheet

```typescript
present_files({
  title: 'Sales Data Q4 2024',
  fileType: 'xlsx',
  artifactUrl: '/workspace/output/sales_q4.xlsx',
});
```

**Result:** User sees a download prompt with Excel icon.

### Example 3: Generated Image

```typescript
present_files({
  title: 'Company Logo - Final Design',
  fileType: 'png',
  artifactUrl: '/workspace/output/logo_final.png',
});
```

**Result:** User sees the image displayed inline.

### Example 4: HTML Visualization

```typescript
present_files({
  title: 'Interactive Sales Dashboard',
  fileType: 'html',
  artifactUrl: '/workspace/output/dashboard.html',
});
```

**Result:** User sees the HTML rendered in a sandboxed iframe.

### Example 5: Markdown Documentation

```typescript
present_files({
  title: 'API Documentation',
  fileType: 'md',
  artifactUrl: '/workspace/output/api_docs.md',
});
```

**Result:** User sees the markdown content in a preview pane.

### Example 6: External URL

```typescript
present_files({
  title: 'Research Paper PDF',
  fileType: 'pdf',
  artifactUrl: 'https://example.com/research/paper.pdf',
});
```

**Result:** User can preview or download the external PDF.

---

## Best Practices

### 1. Always Call After Creating Files

```typescript
// ✅ Good
create_document('/workspace/output/report.docx');
present_files({
  title: 'Business Report',
  fileType: 'docx',
  artifactUrl: '/workspace/output/report.docx',
});

// ❌ Bad - file created but not presented
create_document('/workspace/output/report.docx');
// User never sees the file!
```

### 2. Use Descriptive Titles

```typescript
// ✅ Good - clear and descriptive
present_files({
  title: 'Q4 2024 Sales Analysis Report - Regional Breakdown',
  fileType: 'pdf',
  artifactUrl: '/workspace/output/sales_report.pdf',
});

// ❌ Bad - vague title
present_files({
  title: 'Report',
  fileType: 'pdf',
  artifactUrl: '/workspace/output/sales_report.pdf',
});
```

### 3. Specify Correct File Type

```typescript
// ✅ Good - accurate file type
present_files({
  title: 'Data Export',
  fileType: 'xlsx', // or 'xls'
  artifactUrl: '/workspace/output/data.xlsx',
});

// ❌ Bad - generic or wrong type
present_files({
  title: 'Data Export',
  fileType: 'file', // Not helpful
  artifactUrl: '/workspace/output/data.xlsx',
});
```

### 4. Handle Multiple Files

When presenting multiple files, call the tool multiple times:

```typescript
// Create multiple files
create_report('/workspace/output/report.pdf');
create_spreadsheet('/workspace/output/data.xlsx');
create_chart('/workspace/output/chart.png');

// Present each one
present_files({
  title: 'Financial Report',
  fileType: 'pdf',
  artifactUrl: '/workspace/output/report.pdf',
});

present_files({
  title: 'Supporting Data',
  fileType: 'xlsx',
  artifactUrl: '/workspace/output/data.xlsx',
});

present_files({
  title: 'Sales Trend Chart',
  fileType: 'png',
  artifactUrl: '/workspace/output/chart.png',
});
```

### 5. Workspace Paths vs External URLs

```typescript
// ✅ Workspace files (most common)
artifactUrl: '/workspace/output/file.pdf';

// ✅ Relative paths
artifactUrl: './outputs/file.pdf';

// ✅ External URLs
artifactUrl: 'https://example.com/file.pdf';

// ⚠️ Ensure files exist before presenting
```

---

## Troubleshooting

### File Not Displaying

**Problem:** The file doesn't appear in the preview.

**Solutions:**

1. Check that the file exists at the specified path
2. Verify the `artifactUrl` is correct
3. Ensure the file was created before calling `present_files`
4. Check browser console for errors

### Preview Not Loading

**Problem:** Preview shows "Failed to load" or blank area.

**Solutions:**

1. Verify the file URL is accessible
2. Check CORS settings for external URLs
3. Try downloading the file directly
4. Check file format is supported

### Wrong Preview Type

**Problem:** File shows generic download instead of preview.

**Solutions:**

1. Verify `fileType` matches actual file extension
2. Check file type is supported for preview
3. Some file types (Office docs) only support download

### Security Warning for HTML

**Problem:** HTML preview shows security warning.

**Solution:** This is expected. HTML files are sandboxed for security. Some JavaScript features may not work.

---

## Integration with Skills Agent

The skills-agent prompt already references `present_files`. After creating any artifact:

1. Create file in `/workspace/output/`
2. Call `present_files` with appropriate parameters
3. User sees rich preview automatically

Example flow:

```
User: "Create a sales report for Q4"

Agent:
1. Reads skills for report generation
2. Creates report.pdf in /workspace/output/
3. Calls present_files to display it

User sees: Embedded PDF preview with download button
```

---

## API Reference

### `usePresentFilesAction(component?)`

Registers the present_files AGUI action.

**Parameters:**

- `component` (optional): Custom `ArtifactPreview` component

**Returns:** `void`

### `ArtifactPreview` Component

**Props:**

- `title: string` - Display title
- `fileType: string` - File extension (e.g., "pdf", "png")
- `url: string` - File URL or path
- `className?: string` - Optional CSS class
- `style?: React.CSSProperties` - Optional inline styles

### Tool Schema

```typescript
{
  title: string; // Human-readable title
  fileType: string; // File extension or MIME type
  artifactUrl: string; // URL or path to file
}
```

---

## Next Steps

- [AG-UI Tools Guide](./AG_UI_TOOLS.md) - Complete AGUI documentation
- [API Reference](./API_REFERENCE.md) - Full SDK reference
- [Usage Guide](./USAGE_GUIDE.md) - General SDK patterns
