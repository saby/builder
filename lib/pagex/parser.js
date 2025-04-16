/**
 * Модуль предоставляет метод для парсинга pagex файла.
 *
 * @author Krylov M.A.
 */
'use strict';

const fs = require('fs-extra');
const { Parser } = require('xml2js');

const { path } = require('../platform/path');

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

function parseTree(xml, filePath) {
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

   if (!item.$.hasOwnProperty('type')) {
      throw new Error('Тег item не содержит обязательного атрибута type');
   }

   if (!item.hasOwnProperty('contentConfig')) {
      throw new Error('Тег item не содержит обязательного тега contentConfig');
   }

   let contentConfig;

   try {
      contentConfig = JSON.parse(item.contentConfig);
   } catch (error) {
      throw new Error(`${error.message} in contentConfig at item "${item.$.id}"`);
   }

   return {
      filePath,
      id: item.$.id,
      type: item.$.type,
      contentConfig
   };
}

async function parseSourceFile(rootPath, filePath) {
   const contents = await fs.readFile(filePath, 'utf-8');

   const xml = await parseFile(contents);

   const relFilePath = path.relative(rootPath, filePath);

   return parseTree(xml, relFilePath);
}

module.exports = parseSourceFile;
