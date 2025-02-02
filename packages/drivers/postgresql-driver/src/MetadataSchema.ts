export type MetadataSchemaTypes = 'string' | 'number' | 'boolean' | 'date' | 'json';

export type MetadataSchema = { [field: string]: MetadataSchemaTypes }

export type MetadataSchemaMap = { [key: string]: MetadataSchema }