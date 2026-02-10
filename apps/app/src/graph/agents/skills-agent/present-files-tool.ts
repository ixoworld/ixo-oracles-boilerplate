import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const presentFilesSchema = z.object({
  title: z.string().describe('Human-readable title for the artifact'),
  fileType: z
    .string()
    .describe(
      'File extension or MIME type (e.g., "pdf", "xlsx", "png", "html", "docx"). Used to determine preview type.',
    ),
  artifactUrl: z.string().describe('Public URL to the artifact.'),
});
type PresentFilesArgs = z.infer<typeof presentFilesSchema>;
const presentFilesHandler = async (input: PresentFilesArgs) => {
  return JSON.stringify({
    success: true,
    message: `Presenting artifact: ${input.title}`,
    fileType: input.fileType,
    url: input.artifactUrl,
  });
};

/**
 * Backend tool for presenting files and artifacts to users with rich previews.
 * When this tool runs, the backend dispatches a render_component event
 * (componentName: 'artifactPreview') so the SDK can render ArtifactPreview.
 */
export const presentFilesTool = tool(presentFilesHandler, {
  name: 'present_files',
  description: `Present files and artifacts to the user with rich, interactive previews.`,
  schema: presentFilesSchema,
});
