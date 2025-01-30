import { MetadataSchema } from "./MetadataSchema";
import { RoomData } from "./RoomData";

const serializeChar = String.fromCharCode(0x1F) // unit separator

// better to serialize and unserialize as strings than json
export const serialize = (schema:MetadataSchema, data:RoomData) => {

  const serializable:string[] = []

  for (const field in schema) { // obviously order is very important here
    if (data.hasOwnProperty(field)) {
      serializable.push(data[field].toString())
    } else if (data.metadata.hasOwnProperty(field)){
      serializable.push(data.metadata[field].toString())
    }
  }

  return serializable.join(serializeChar)
}

export const unserialize = (schema:MetadataSchema, serialized:string) => {

  const unserialized:{[field:string]:string | number | boolean} = {}

  const values = serialized.split(serializeChar)

  let i = 0
  for (const field in schema) {
    unserialized[field] = values[i]
    i++
  }

  return unserialized
}
