import { jsonToYaml } from '../json-to-yaml.js';

describe('jsonToYaml', () => {
  it('should convert flat JSON object to YAML', () => {
    const json = {
      name: 'John',
      age: 30,
      city: 'New York',
    };
    const expected = 'name: John\nage: 30\ncity: New York';
    expect(jsonToYaml(json)).toBe(expected);
  });

  it('should handle nested objects', () => {
    const json = {
      person: {
        name: 'John',
        address: {
          city: 'New York',
          zip: '10001',
        },
      },
    };
    const expected =
      'person:\n  name: John\n  address:\n    city: New York\n    zip: 10001';
    expect(jsonToYaml(json)).toBe(expected);
  });

  it('should handle arrays as nested objects', () => {
    const json = {
      fruits: ['apple', 'banana', 'orange'],
    };
    const expected = 'fruits:\n  0: apple\n  1: banana\n  2: orange';
    expect(jsonToYaml(json)).toBe(expected);
  });

  it('should handle empty objects', () => {
    const json = {};
    expect(jsonToYaml(json)).toBe('');
  });

  it('should handle null values', () => {
    const json = {
      name: null,
      age: 30,
    };
    const expected = 'name: null\nage: 30';
    expect(jsonToYaml(json)).toBe(expected);
  });

  it('should handle mixed types', () => {
    const json = {
      string: 'text',
      number: 42,
      boolean: true,
      nullValue: null,
    };
    const expected = 'string: text\nnumber: 42\nboolean: true\nnullValue: null';
    expect(jsonToYaml(json)).toBe(expected);
  });

  it('should handle custom indentation level', () => {
    const json = {
      name: 'John',
      age: 30,
    };
    const expected = '    name: John\n    age: 30';
    expect(jsonToYaml(json, 2)).toBe(expected);
  });
});
