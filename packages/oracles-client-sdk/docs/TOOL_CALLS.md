# Tool Calls & Browser Tools Guide

Complete guide to handling tool calls and implementing browser-side tools.

## Table of Contents

- [Understanding Tool Calls](#understanding-tool-calls)
- [Tool Call Rendering Pattern](#tool-call-rendering-pattern)
- [Generic ToolCall Component](#generic-toolcall-component)
- [Custom Tool Components](#custom-tool-components)
- [Browser Tools](#browser-tools)
- [Complete Examples](#complete-examples)

---

## Understanding Tool Calls

Tool calls allow the AI oracle to invoke functions and display rich, interactive results.

### Two Types of Tools

1. **Server-side Tools** - Run on the oracle backend

   - Web search, database queries, API calls
   - Results sent via events/WebSocket
   - Displayed using UI components

2. **Browser Tools** - Run in the user's browser
   - Access user's location, camera, local storage
   - Run immediately without server roundtrip
   - Results sent back to oracle

---

## Tool Call Rendering Pattern

The SDK uses a **fallback pattern** for rendering tool calls:

### Fallback Logic

```typescript
// 1. Check if custom component exists for this tool
if (uiComponents[toolName]) {
  // Use custom component (e.g., WeatherWidget for check_weather)
  <WeatherWidget {...props} />
} else {
  // Fall back to generic ToolCall component
  <ToolCall toolName={toolName} {...props} />
}
```

### Why This Pattern?

- ✅ **Flexibility** - Create custom UI for important tools
- ✅ **Graceful degradation** - Generic fallback for new/unknown tools
- ✅ **Maintainable** - No need to define every possible tool

---

## Generic ToolCall Component

Create a reusable generic component for all tool calls:

```tsx
// components/ToolCall.tsx
interface ToolCallProps {
  toolName: string;
  args: Record<string, unknown>;
  output?: string;
  status?: 'isRunning' | 'done';
  isLoading?: boolean;
}

export function ToolCall({
  toolName,
  args,
  output,
  status,
  isLoading,
}: ToolCallProps) {
  const isRunning = status === 'isRunning' || isLoading;

  return (
    <div className="tool-call">
      <div className="tool-call-header">
        <span className="tool-icon">🔧</span>
        <span className="tool-name">{formatToolName(toolName)}</span>
        {isRunning && <Spinner />}
      </div>

      {/* Show arguments while running */}
      {isRunning && (
        <div className="tool-call-args">
          <details>
            <summary>Arguments</summary>
            <pre>{JSON.stringify(args, null, 2)}</pre>
          </details>
        </div>
      )}

      {/* Show output when done */}
      {output && status === 'done' && (
        <div className="tool-call-output">
          <div className="output-label">Result:</div>
          <div className="output-content">{output}</div>
        </div>
      )}
    </div>
  );
}

// Helper to format tool_name_like_this → Tool Name Like This
function formatToolName(name: string): string {
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
```

## Example: Custom Tool Components

Create custom components for specific tools:

### Example: Weather Tool

```tsx
// components/WeatherWidget.tsx
interface WeatherProps {
  city: string;
  temperature: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  isLoading?: boolean;
}

export function WeatherWidget({
  city,
  temperature,
  condition,
  humidity,
  windSpeed,
  isLoading,
}: WeatherProps) {
  if (isLoading) {
    return (
      <div className="weather-widget loading">
        <Spinner />
        <span>Checking weather in {city}...</span>
      </div>
    );
  }

  const weatherIcon = getWeatherIcon(condition);

  return (
    <div className="weather-widget">
      <div className="weather-header">
        <h3>{city}</h3>
        <div className="weather-icon">{weatherIcon}</div>
      </div>

      <div className="weather-main">
        <div className="temperature">{temperature}°C</div>
        <div className="condition">{condition}</div>
      </div>

      <div className="weather-details">
        <div className="detail">
          <span className="icon">💧</span>
          <span>Humidity: {humidity}%</span>
        </div>
        <div className="detail">
          <span className="icon">💨</span>
          <span>Wind: {windSpeed} km/h</span>
        </div>
      </div>
    </div>
  );
}

function getWeatherIcon(condition: string): string {
  const icons: Record<string, string> = {
    sunny: '☀️',
    cloudy: '☁️',
    rainy: '🌧️',
    snowy: '❄️',
    thunderstorm: '⛈️',
  };
  return icons[condition.toLowerCase()] || '🌤️';
}
```

### Registering Components

```tsx
import { ToolCall } from './components/ToolCall';
import { WeatherWidget } from './components/WeatherWidget';

function Chat({ oracleDid, sessionId }) {
  const { messages } = useChat({
    oracleDid,
    sessionId,
    uiComponents: {
      // Generic fallback - REQUIRED
      ToolCall,

      // Custom components - OPTIONAL
      check_weather: WeatherWidget, // check_weather → WeatherWidget
      get_stock_price: StockPriceWidget,
      search_database: DatabaseResultsTable,
    },
    onPaymentRequiredError: () => {},
  });

  return (
    <div>
      {messages.map((msg) => (
        <div key={msg.id}>
          {renderMessageContent(msg.content, uiComponents)}
        </div>
      ))}
    </div>
  );
}
```

---

## Browser Tools

Browser tools run in the user's browser, giving the AI access to client-side capabilities.

### Basic Browser Tool

```tsx
import { z } from 'zod';

const browserTools = {
  getCurrentLocation: {
    toolName: 'getCurrentLocation',
    description: "Get the user's current GPS location",
    schema: z.object({}),
    fn: async () => {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Geolocation not supported'));
          return;
        }

        navigator.geolocation.getCurrentPosition(
          (position) => {
            resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
            });
          },
          (error) => reject(error),
        );
      });
    },
  },
};

const { sendMessage } = useChat({
  oracleDid,
  sessionId,
  browserTools, // Pass browser tools
  onPaymentRequiredError: () => {},
});
```

### Browser Tool with Parameters

```tsx
const browserTools = {
  readLocalStorage: {
    toolName: 'readLocalStorage',
    description: 'Read a value from browser local storage',
    schema: z.object({
      key: z.string().describe('The key to read from localStorage'),
    }),
    fn: async ({ key }: { key: string }) => {
      const value = localStorage.getItem(key);
      return {
        key,
        value,
        exists: value !== null,
      };
    },
  },

  saveToLocalStorage: {
    toolName: 'saveToLocalStorage',
    description: 'Save a value to browser local storage',
    schema: z.object({
      key: z.string().describe('The key to save'),
      value: z.string().describe('The value to save'),
    }),
    fn: async ({ key, value }: { key: string; value: string }) => {
      localStorage.setItem(key, value);
      return {
        success: true,
        key,
        savedAt: new Date().toISOString(),
      };
    },
  },
};
```

### Visual Browser Tool - Screenshot Annotation

```tsx
const browserTools = {
  captureScreenshot: {
    toolName: 'captureScreenshot',
    description: 'Capture a screenshot of the current page',
    schema: z.object({
      element: z
        .string()
        .optional()
        .describe('CSS selector to capture (optional)'),
    }),
    fn: async ({ element }: { element?: string }) => {
      // Use html2canvas library
      const targetElement = element
        ? document.querySelector(element)
        : document.body;

      if (!targetElement) {
        throw new Error(`Element not found: ${element}`);
      }

      const canvas = await html2canvas(targetElement as HTMLElement);
      const dataUrl = canvas.toDataURL('image/png');

      return {
        screenshot: dataUrl,
        width: canvas.width,
        height: canvas.height,
        timestamp: new Date().toISOString(),
      };
    },
  },
};

// Custom component to display screenshot
function ScreenshotDisplay({ screenshot, width, height, isLoading }) {
  if (isLoading) {
    return <div>Capturing screenshot...</div>;
  }

  return (
    <div className="screenshot-display">
      <div className="screenshot-info">
        Screenshot captured ({width} × {height}px)
      </div>
      <img
        src={screenshot}
        alt="Screenshot"
        style={{ maxWidth: '100%', border: '1px solid #ddd' }}
      />
    </div>
  );
}

// Register component
const uiComponents = {
  ToolCall,
  captureScreenshot: ScreenshotDisplay,
};
```

### Browser Tool - Show Component in Chat

```tsx
import { useState } from 'react';

const browserTools = {
  showColorPicker: {
    toolName: 'showColorPicker',
    description: 'Show a color picker and return the selected color',
    schema: z.object({
      defaultColor: z
        .string()
        .optional()
        .describe('Default color in hex format'),
    }),
    fn: async ({ defaultColor = '#000000' }: { defaultColor?: string }) => {
      return new Promise((resolve) => {
        // Create a temporary color picker
        const input = document.createElement('input');
        input.type = 'color';
        input.value = defaultColor;
        input.style.position = 'absolute';
        input.style.opacity = '0';
        document.body.appendChild(input);

        input.addEventListener('change', (e) => {
          const color = (e.target as HTMLInputElement).value;
          document.body.removeChild(input);
          resolve({
            color,
            rgb: hexToRgb(color),
            selectedAt: new Date().toISOString(),
          });
        });

        input.click();
      });
    },
  },

  showNotification: {
    toolName: 'showNotification',
    description: 'Show a browser notification to the user',
    schema: z.object({
      title: z.string().describe('Notification title'),
      body: z.string().describe('Notification body'),
      icon: z.string().optional().describe('Icon URL'),
    }),
    fn: async ({
      title,
      body,
      icon,
    }: {
      title: string;
      body: string;
      icon?: string;
    }) => {
      // Request permission if not granted
      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }

      if (Notification.permission === 'granted') {
        new Notification(title, { body, icon });
        return { success: true, permission: 'granted' };
      }

      return { success: false, permission: Notification.permission };
    },
  },
};

// Custom component for color picker result
function ColorPickerResult({ color, rgb, isLoading }) {
  if (isLoading) {
    return <div>Opening color picker...</div>;
  }

  return (
    <div className="color-result">
      <div className="color-preview" style={{ background: color }}>
        <div
          className="color-swatch"
          style={{
            background: color,
            width: 100,
            height: 100,
            borderRadius: 8,
            border: '2px solid #fff',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}
        />
      </div>
      <div className="color-info">
        <div>
          <strong>Hex:</strong> {color}
        </div>
        <div>
          <strong>RGB:</strong> {rgb}
        </div>
      </div>
    </div>
  );
}

const uiComponents = {
  ToolCall,
  showColorPicker: ColorPickerResult,
};

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return 'Invalid';
  return `rgb(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)})`;
}
```

---

## Best Practices

### 1. Always Provide ToolCall Fallback

```tsx
// ✅ Good - has fallback
uiComponents: {
  ToolCall,  // Handles unknown tools
  check_weather: WeatherWidget,
}

// ❌ Bad - no fallback
uiComponents: {
  check_weather: WeatherWidget,  // Other tools won't render
}
```

### 2. Make Tool Components Responsive

```tsx
function ResponsiveToolComponent({ isLoading, ...props }) {
  if (isLoading) {
    return <LoadingState />;
  }

  if (props.error) {
    return <ErrorState error={props.error} />;
  }

  return <SuccessState {...props} />;
}
```

### 3. Handle Browser Tool Permissions

```tsx
const browserTools = {
  accessCamera: {
    toolName: 'accessCamera',
    description: 'Access user camera',
    schema: z.object({}),
    fn: async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        // ... use stream
        return { success: true };
      } catch (error) {
        if (error.name === 'NotAllowedError') {
          return {
            success: false,
            error: 'Camera permission denied. Please allow camera access.',
          };
        }
        throw error;
      }
    },
  },
};
```

## Next Steps

- [Usage Guide](./USAGE_GUIDE.md) - General SDK usage
- [API Reference](./API_REFERENCE.md) - Complete API docs
