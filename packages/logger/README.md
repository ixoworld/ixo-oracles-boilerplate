# `@ixo/logger`

## Logger Module
This module provides a singleton Logger class for logging messages with different levels (info, warn, error) using the Winston logging library. It includes custom formatting and supports logging additional metadata


```ts
import { Logger } from '@ixo/logger';

// Log an info message
Logger.info('This is an info message');

// Log a warning message
Logger.warn('This is a warning message');

// Log an error message
Logger.error('This is an error message');
```