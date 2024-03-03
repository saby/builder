'use strict';

export * as templateContent from 'tmpl!Module/_private/TimeTester';

export function toJSON() {
   return {
      is: "primitive",
      id: "widget",
      inherits: [],
      required: true,
      info: {},
      attributes: []
   };
}
