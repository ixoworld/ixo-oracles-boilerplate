export const validateRoutes = <
  K extends string[],
  R extends Record<string, string> = Record<string, string>,
>(
  routes: R,
  basedOn: K,
): (keyof R)[] => {
  const keys = Object.keys(routes) as (keyof R)[];
  if (keys.length <= 1) {
    throw new Error(
      `The routes must have at least 2 routes ${keys.toString()} provided`,
    );
  }
  for (const key in routes) {
    const value = routes[key];

    basedOn.forEach((element) => {
      if (!value?.includes(element)) {
        throw new Error(
          `Invalid route map the value of the route ${key} must include the ${basedOn.toString()} So that the route can be resolve the path`,
        );
      }
    });
  }
  return keys;
};
