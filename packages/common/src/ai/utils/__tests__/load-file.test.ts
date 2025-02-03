import { Document } from '@langchain/core/documents';
import fs from 'node:fs/promises';
import { loadFile } from '../load-file';

// Mock the external dependencies
jest.mock('node:fs/promises');
jest.mock('@langchain/community/document_loaders/fs/pdf');
jest.mock('@langchain/community/document_loaders/fs/docx');
jest.mock('@ixo/logger');

// Mock fetch for URL testing
const mockFetch = jest.fn();
global.fetch = mockFetch;
global.Blob = Blob;

describe('loadFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Local File Loading', () => {
    it('should load a PDF file', async () => {
      const mockBuffer = Buffer.from('mock pdf content');
      (fs.readFile as jest.Mock).mockResolvedValue(mockBuffer);

      await loadFile('test.pdf');

      expect(fs.readFile).toHaveBeenCalledWith('test.pdf');
    });

    it('should load a Markdown file', async () => {
      const mockContent = '# Test Markdown';
      const mockBuffer = Buffer.from(mockContent);
      (fs.readFile as jest.Mock).mockResolvedValue(mockBuffer);

      const result = await loadFile('test.md');

      expect(fs.readFile).toHaveBeenCalledWith('test.md');
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toBeInstanceOf(Document);
    });

    it('should load a text file', async () => {
      const mockContent = 'Test text content';
      const mockBuffer = Buffer.from(mockContent);
      (fs.readFile as jest.Mock).mockResolvedValue(mockBuffer);

      const result = await loadFile('test.txt');

      expect(fs.readFile).toHaveBeenCalledWith('test.txt');
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toBeInstanceOf(Document);
    });

    it('should throw error for unsupported file type', async () => {
      await expect(loadFile('test.xyz')).rejects.toThrow(
        'Unsupported file type',
      );
    });

    it('should handle file read errors', async () => {
      (fs.readFile as jest.Mock).mockRejectedValue(new Error('File not found'));

      await expect(loadFile('nonexistent.pdf')).rejects.toThrow(
        'File not found',
      );
    });
  });

  describe('URL Loading', () => {
    it('should load a file from URL', async () => {
      const mockResponse = new Response('mock content', {
        headers: { 'content-type': 'text/plain' },
      });
      mockFetch.mockResolvedValue(mockResponse);

      await loadFile('http://example.com/test.txt');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://example.com/test.txt',
        undefined,
      );
    });

    it('should handle URL fetch errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(loadFile('http://example.com/test.pdf')).rejects.toThrow(
        'Network error',
      );
    });

    it('should handle non-OK responses', async () => {
      const mockResponse = new Response('Not Found', { status: 404 });
      mockFetch.mockResolvedValue(mockResponse);

      await expect(loadFile('http://example.com/test.pdf')).rejects.toThrow(
        'Failed to fetch file from URL',
      );
    });

    it('should pass fetch options when provided', async () => {
      const mockResponse = new Response('mock content', {
        headers: { 'content-type': 'text/plain' },
      });
      mockFetch.mockResolvedValue(mockResponse);

      const fetchOptions = {
        headers: { Authorization: 'Bearer token' },
      };

      await loadFile('http://example.com/test.txt', fetchOptions);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://example.com/test.txt',
        fetchOptions,
      );
    });
  });

  describe('File Type Detection', () => {
    it('should detect file type from extension', async () => {
      const mockBuffer = Buffer.from('mock content');
      (fs.readFile as jest.Mock).mockResolvedValue(mockBuffer);

      await loadFile('test.pdf');
      await loadFile('test.md');
      await loadFile('test.txt');
      await loadFile('test.html');
      await loadFile('test.docx');

      expect(fs.readFile).toHaveBeenCalledTimes(5);
    });

    it('should detect file type from content-type header', async () => {
      const mockResponse = new Response('mock content', {
        headers: { 'content-type': 'application/pdf' },
      });
      mockFetch.mockResolvedValue(mockResponse);

      await loadFile('http://example.com/document');

      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
