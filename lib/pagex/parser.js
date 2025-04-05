/**
 * Модуль предоставляет метод для парсинга pagex файла.
 *
 * @author Krylov M.A.
 */
'use strict';

const { Parser } = require('xml2js');

const EMPTY_ARRAY = Object.freeze([]);

function parseFile(contents) {
   const parser = new Parser();

   return new Promise((resolve, reject) => {
      parser.parseString(contents, (error, result) => {
         if (error === null) {
            return resolve(result);
         }

         const message = error.message.replace(/\n/g, ' ');

         return reject(new Error(message));
      });
   });
}

async function parseSourceFile(filePath, contents) {
   const xml = await parseFile(contents);

   if (xml === null) {
      return EMPTY_ARRAY;
   }

   if (!xml.hasOwnProperty('page')) {
      return EMPTY_ARRAY;
   }

   if (!xml.page.hasOwnProperty('item')) {
      return EMPTY_ARRAY;
   }

   if (!Array.isArray(xml.page.item)) {
      return EMPTY_ARRAY;
   }

   return xml.page.item.map(parseItem.bind(undefined, filePath));
}

function parseItem(filePath, item) {
   if (!item.hasOwnProperty('$')) {
      throw new Error('Тег item не содержит атрибутов');
   }

   if (!item.$.hasOwnProperty('id')) {
      throw new Error('Тег item не содержит обязательного атрибута id');
   }

   let contentConfig;

   try {
      contentConfig = item.contentConfig ? JSON.parse(item.contentConfig) : {};
   } catch (error) {
      throw new Error(`${error.message} in contentConfig at item "${item.$.id}"`);
   }

   return {
      filePath,
      id: item.$.id,
      type: item.$.type ? item.$.type : undefined,
      contentConfig
   };
}

module.exports = parseSourceFile;
