// ============= src/middleware/validation.ts =============
/**
 * Request Validation Middleware
 * 
 * Validates request body, query, and params against defined schemas
 */

import { Request, Response, NextFunction } from 'express';

// ============= TYPES =============

type ValidationType = 'string' | 'number' | 'boolean' | 'object' | 'array';

interface FieldSchema {
  type: ValidationType;
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  properties?: Record<string, FieldSchema>;
}

interface ValidationSchema {
  body?: Record<string, FieldSchema>;
  query?: Record<string, FieldSchema>;
  params?: Record<string, FieldSchema>;
}

interface ValidationError {
  field: string;
  message: string;
}

// ============= VALIDATION FUNCTIONS =============

/**
 * Validate a field against its schema
 */
function validateField(
  value: any,
  fieldName: string,
  schema: FieldSchema
): ValidationError | null {
  // Check required
  if (schema.required && (value === undefined || value === null || value === '')) {
    return {
      field: fieldName,
      message: `${fieldName} is required`
    };
  }

  // If not required and no value, skip further validation
  if (!schema.required && (value === undefined || value === null || value === '')) {
    return null;
  }

  // Check type
  if (schema.type === 'number') {
    if (isNaN(Number(value))) {
      return {
        field: fieldName,
        message: `${fieldName} must be a number`
      };
    }
    const numValue = Number(value);

    // Check min
    if (schema.min !== undefined && numValue < schema.min) {
      return {
        field: fieldName,
        message: `${fieldName} must be at least ${schema.min}`
      };
    }

    // Check max
    if (schema.max !== undefined && numValue > schema.max) {
      return {
        field: fieldName,
        message: `${fieldName} must be at most ${schema.max}`
      };
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') {
      return {
        field: fieldName,
        message: `${fieldName} must be a string`
      };
    }

    // Check min length
    if (schema.min !== undefined && value.length < schema.min) {
      return {
        field: fieldName,
        message: `${fieldName} must be at least ${schema.min} characters`
      };
    }

    // Check max length
    if (schema.max !== undefined && value.length > schema.max) {
      return {
        field: fieldName,
        message: `${fieldName} must be at most ${schema.max} characters`
      };
    }

    // Check pattern
    if (schema.pattern && !schema.pattern.test(value)) {
      return {
        field: fieldName,
        message: `${fieldName} has invalid format`
      };
    }
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
      return {
        field: fieldName,
        message: `${fieldName} must be a boolean`
      };
    }
  } else if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return {
        field: fieldName,
        message: `${fieldName} must be an object`
      };
    }

    // Validate nested properties
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        const error = validateField(value[propName], `${fieldName}.${propName}`, propSchema);
        if (error) {
          return error;
        }
      }
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      return {
        field: fieldName,
        message: `${fieldName} must be an array`
      };
    }
  }

  return null;
}

/**
 * Validate data against schema
 */
function validateData(
  data: Record<string, any>,
  schema: Record<string, FieldSchema>
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [fieldName, fieldSchema] of Object.entries(schema)) {
    const error = validateField(data[fieldName], fieldName, fieldSchema);
    if (error) {
      errors.push(error);
    }
  }

  return errors;
}

// ============= MIDDLEWARE =============

/**
 * @middleware validateRequest
 * @desc       Validate request body, query, and params
 * @usage      validateRequest({ body: { ... }, query: { ... } })
 */
export function validateRequest(schema: ValidationSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: ValidationError[] = [];

    // Validate body
    if (schema.body) {
      const bodyErrors = validateData(req.body || {}, schema.body);
      errors.push(...bodyErrors);
    }

    // Validate query
    if (schema.query) {
      const queryErrors = validateData(req.query as Record<string, any>, schema.query);
      errors.push(...queryErrors);
    }

    // Validate params
    if (schema.params) {
      const paramErrors = validateData(req.params as Record<string, any>, schema.params);
      errors.push(...paramErrors);
    }

    // If there are errors, return 400
    if (errors.length > 0) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors.map(e => ({
          field: e.field,
          message: e.message
        }))
      });
      return;
    }

    next();
  };
}

/**
 * @middleware validateBody
 * @desc       Validate only request body
 * @usage      validateBody({ amountUSDC: { type: 'number', required: true } })
 */
export function validateBody(schema: Record<string, FieldSchema>) {
  return validateRequest({ body: schema });
}

/**
 * @middleware validateQuery
 * @desc       Validate only request query
 * @usage      validateQuery({ limit: { type: 'number' } })
 */
export function validateQuery(schema: Record<string, FieldSchema>) {
  return validateRequest({ query: schema });
}

/**
 * @middleware validateParams
 * @desc       Validate only request params
 * @usage      validateParams({ id: { type: 'string', required: true } })
 */
export function validateParams(schema: Record<string, FieldSchema>) {
  return validateRequest({ params: schema });
}

// ============= EXAMPLE USAGE =============

/**
 * Example: Validate POST /api/offramp/initiate
 * 
 * router.post(
 *   '/initiate',
 *   authMiddleware,
 *   validateRequest({
 *     body: {
 *       amountUSDC: {
 *         type: 'number',
 *         required: true,
 *         min: 10,
 *         max: 5000
 *       },
 *       beneficiary: {
 *         type: 'object',
 *         required: true,
 *         properties: {
 *           name: { type: 'string', required: true },
 *           accountNumber: { type: 'string', required: true },
 *           bankCode: { type: 'string', required: true }
 *         }
 *       }
 *     }
 *   }),
 *   initiateOfframp
 * );
 */

export default {
  validateRequest,
  validateBody,
  validateQuery,
  validateParams
};