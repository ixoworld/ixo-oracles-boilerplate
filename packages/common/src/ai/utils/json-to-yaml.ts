export const jsonToYaml = <T extends object>(
  json: T,
  indentLevel = 0,
): string => {
  const indent = '  '.repeat(indentLevel); // Two spaces per level of indentation
  return Object.entries(json)
    .map(([key, value]) => {
      if (value !== null && typeof value === 'object') {
        // Recursively process nested objects with increased indentation
        const nestedYaml = jsonToYaml(value, indentLevel + 1);
        return `${indent}${key}:\n${nestedYaml}`;
      }
      return `${indent}${key}: ${value}`;
    })
    .join('\n');
};
