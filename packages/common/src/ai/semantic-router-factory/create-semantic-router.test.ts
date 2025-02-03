import { createSemanticRouter } from './create-semantic-router';

const parse = jest.fn();
const create = jest.fn();
jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => {
    function fn(): unknown {
      return {};
    }

    fn.beta = {
      chat: {
        completions: { parse },
      },
    };

    fn.chat = {
      completions: { create },
    };
    return fn;
  }),
}));

describe('createSemanticRouter', () => {
  it('should create a semantic router with valid routes', () => {
    // const router = createSemanticRouter(
    //   {
    //     generateBlog: 'if the intent is blog',
    //     generateSocialMediaPost: 'if the intent is post',
    //   },
    //   ['intent'],
    // );
    expect(() =>
      createSemanticRouter(
        {
          generateBlog: 'if the intent is blog',
          generateSocialMediaPost: 'if the intent is post',
        },
        ['intent'],
      ),
    ).not.toThrow();
  });

  it('should fail to create a semantic router with invalid routes', () => {
    expect(() => createSemanticRouter({}, ['intent'])).toThrow();
  });

  it('should fail to get route with invalid state', async () => {
    const router = createSemanticRouter(
      {
        generateBlog: 'if the intent is blog',
        generateSocialMediaPost: 'if the intent is post',
      },
      ['intent'],
    );
    await expect(
      router({
        foo: 'boo',
      }),
    ).rejects.toThrow();
  });

  it('should get route with valid state', async () => {
    const router = createSemanticRouter(
      {
        generateBlog: 'if the intent is blog',
        generateSocialMediaPost: 'if the intent is post',
      },
      ['intent'],
      'gpt-4o-mini',
      false,
    );

    parse.mockResolvedValue({
      choices: [
        {
          message: {
            parsed: {
              nextRoute: 'generateBlog',
            },
            content: 'generateBlog',
            role: 'assistant',
            refusal: null,
            tool_calls: [],
          },
          finish_reason: 'stop',
          index: 0,
          logprobs: null,
        },
      ],
    });

    const route = await router({
      intent: 'blog',
    });
    expect(route).toBe('generateBlog');
  });
});
