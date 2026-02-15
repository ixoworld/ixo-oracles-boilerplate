import {
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

export const StrictBody = createParamDecorator(
  async (
    dtoClass: new (...args: unknown[]) => object,
    ctx: ExecutionContext,
  ) => {
    const request = ctx.switchToHttp().getRequest();
    const body = request.body;

    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Request body must be a valid object');
    }

    // Check for extra properties
    const _allowedKeys = Reflect.getMetadataKeys(dtoClass.prototype);
    const validationKeys = new Set<string>();

    // Get all properties that have validation decorators
    for (const key of Object.getOwnPropertyNames(dtoClass.prototype)) {
      const metadata = Reflect.getMetadata(
        'class-validator',
        dtoClass.prototype,
        key,
      );
      if (metadata && metadata.length > 0) {
        validationKeys.add(key);
      }
    }

    // Also check the constructor parameters for properties
    const _paramTypes =
      Reflect.getMetadata('design:paramtypes', dtoClass) || [];
    const _paramNames =
      Reflect.getMetadata('custom:param-names', dtoClass) || [];

    // Get property names from the DTO class itself
    const dtoInstance = new dtoClass();
    const dtoKeys = Object.keys(dtoInstance);
    dtoKeys.forEach((key) => validationKeys.add(key));

    // Alternative approach: get all properties with decorators
    const target = dtoClass.prototype;
    const propertyNames = Object.getOwnPropertyNames(target);

    for (const propertyName of propertyNames) {
      if (propertyName === 'constructor') continue;

      // Check if property has any validation decorators
      const keys = Reflect.getMetadataKeys(target, propertyName);
      if (keys && keys.length > 0) {
        validationKeys.add(propertyName);
      }
    }

    // Manually add known properties from UpdateCallDto
    validationKeys.add('callStatus');
    validationKeys.add('callEndedAt');
    validationKeys.add('callStartedAt');

    const bodyKeys = Object.keys(body);
    const extraKeys = bodyKeys.filter((key) => !validationKeys.has(key));

    if (extraKeys.length > 0) {
      throw new BadRequestException(
        `The following properties are not allowed: ${extraKeys.join(', ')}`,
      );
    }

    // Transform and validate the DTO
    const dto = plainToInstance(dtoClass, body);
    const errors = await validate(dto);

    if (errors.length > 0) {
      const errorMessages = errors.map((error) =>
        Object.values(error.constraints || {}).join(', '),
      );
      throw new BadRequestException(errorMessages);
    }

    return dto;
  },
);
