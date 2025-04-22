import { RequestHandler, Router, RouterOptions } from 'express';
import asyncHandler from 'express-async-handler';

type RouterMethod = (path: string, ...handlers: RequestHandler[]) => Router;

const AsyncRouter = (options?: RouterOptions) => {
  const router: Router = Router(options);
  const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;

  methods.forEach((method) => {
    const original = router[method] as RouterMethod;
    router[method] = function (path: string, ...handlers: RequestHandler[]) {
      const wrapped = handlers.map((fn) => {
        if (typeof fn === 'function') return asyncHandler(fn);
        return fn;
      });

      return original.call(this, path, ...wrapped);
    };
  });

  return router;
};

export default AsyncRouter;
