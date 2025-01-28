export type MetadataSchemaTypes = 'string' | 'number' | 'boolean' | 'json';

export type MetadataSchema = { [field: string]: MetadataSchemaTypes }