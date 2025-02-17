/* eslint-disable no-console -- debug */
import { type ComponentProps } from 'react';

export type UIComponents = Record<string, React.FC<any>>;

export const resolveUIComponent = (
  componentsMap: Partial<UIComponents>,
  component: {
    name: string;
    props: {
      id: string;
      args: unknown;
      status?: 'isRunning' | 'done';
    };
  },
): React.ReactElement | undefined => {
  if (!isValidProps(component.props.args)) {
    return undefined;
  }

  const Component =
    component.name in componentsMap ? componentsMap[component.name] : undefined;
  if (!Component) {
    console.warn(`Component ${component.name} not found`);
    return undefined;
  }

  const isRunning = component.props.status === 'isRunning';
  const isComponentCanHandleLoading = checkIfComponentCanHandleLoading(
    Component.prototype,
  );
  if (isRunning && !isComponentCanHandleLoading) {
    const showArgs = Object.keys(component.props.args).length > 0;
    return (
      <div
        key={`${component.name}${component.props.id}`}
        className="rounded-xl border bg-card text-card-foreground shadow animate-pulse"
      >
        <div className="flex flex-col space-y-1.5 p-6">
          <h3 className="font-semibold leading-none tracking-tight">
            {component.name} is running
          </h3>
          {showArgs && (
            <code>
              <pre>{JSON.stringify(component.props.args, null, 2)}</pre>
            </code>
          )}
        </div>
      </div>
    );
  }

  return (
    <Component
      key={`${component.name}${component.props.id}`}
      {...component.props.args}
      isLoading={isRunning && isComponentCanHandleLoading}
    />
  );
};

const isValidProps = (
  props: unknown,
): props is ComponentProps<UIComponents[keyof UIComponents]> => {
  return typeof props === 'object' && props !== null;
};

const checkIfComponentCanHandleLoading = (prototype: unknown): boolean =>
  Boolean(
    prototype &&
      typeof prototype === 'object' &&
      'canHandleLoadingState' in prototype &&
      typeof prototype.canHandleLoadingState === 'boolean' &&
      prototype.canHandleLoadingState,
  );
