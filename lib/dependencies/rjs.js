/**
 * Модуль, предназначенный для работы с зависимостями RequireJS.
 *
 * @author Krylov M.A.
 */
'use strict';

/**
 * Имена псевдоинтерфейсных модулей модуля WS.Core.
 * @type {Set<string>}
 */
const WSCorePaths = new Set([
   'WS',
   'Core',
   'Lib',
   'Ext',
   'Helpers',
   'Transport'
]);

/**
 * Создать словарь плагинов из последовательности.
 * @param {{ name: string, arg: string }[]} plugins Последовательность плагинов зависимости.
 * @returns {Map<string, { index: number, arg?: string }>} Словарь плагинов зависимостей.
 */
function createPluginsMap(plugins) {
   return new Map(plugins.map(({ name, arg }, index) => ([name, { index, arg }])));
}

/**
 * Собрать все плагины в строку, учитывая их порядок.
 * @param {Map<string, { index: number, arg: string }>} plugins Словарь плагинов зависимостей.
 * @return {string} Префикс зависимости.
 */
function compilePlugins(plugins) {
   return Array.from(plugins)
      .map(([name, { index, arg }]) => ({ name, index, arg }))
      .sort((a, b) => Math.sign(a.index - b.index))
      .map(plugin => (typeof plugin.arg === 'string' ? `${plugin.name}!${plugin.arg}?` : `${plugin.name}!`))
      .join('');
}

/**
 * Класс, предоставляющий методы для работы с RequireJS зависимостью.
 */
class RequireJSModule {
   /**
    * Инициализировать новый инстанс зависимости.
    * @param {string} name Имя зависимости.
    * @param {{ name: string, arg: string }[]} plugins Последовательность плагинов зависимости.
    */
   constructor(name, plugins = []) {
      this.name = name;
      this.plugins = createPluginsMap(plugins);
   }

   /**
    * Получить сырое имя зависимости.
    * @return {string}
    */
   get raw() {
      return `${compilePlugins(this.plugins)}${this.name}`;
   }

   /**
    * Получить имя интерфейсного модуля зависимости.
    * @return {string}
    */
   get uiName() {
      const uiName = this.name.split('/').shift();

      if (WSCorePaths.has(uiName)) {
         return 'WS.Core';
      }

      if (uiName === 'Deprecated') {
         return 'WS.Deprecated';
      }

      return uiName;
   }

   /**
    * Клонировать инстанс зависимости.
    * @return {RequireJSModule} Копия инстанса зависимости.
    */
   clone() {
      return parse(this.raw);
   }

   /**
    * Добавить зависимости плагин в формате "name!arg?".
    * @param {string} name Имя плагина.
    * @param {string?} arg Аргумент плагина.
    */
   addPlugin(name, arg) {
      if (this.plugins.has(name)) {
         this.plugins.set(name, {
            ...this.plugins.get(name),
            arg
         });

         return;
      }

      this.plugins.set(name, {
         index: this.plugins.size,
         arg
      });
   }

   /**
    * Проверить наличие плагина у зависимости.
    * @param {string} name Имя плагина.
    * @return {boolean} Возвращает true, если зависимость имеет плагин с данным именем.
    */
   hasPlugin(name) {
      return this.plugins.has(name);
   }

   /**
    * Удалить плагин из зависимости.
    * @param {string} name Имя плагина.
    * @return {boolean} Возвращает true, если плагин был удален из зависимости.
    */
   deletePlugin(name) {
      return this.plugins.delete(name);
   }
}

/**
 * Выполнить разбор зависимости.
 * @param {string} rawName Полное имя зависимости с плагинами.
 * @return {RequireJSModule} Инстанс класса, предоставляющего методы для работы с зависимостью.
 */
function parse(rawName) {
   const pluginRe = /^(([^!]+)!(([^!?]+)\?)?)/;
   const plugins = [];

   let module = rawName;
   let result = pluginRe.exec(module);

   while (result !== null) {
      const name = result[2];
      const arg = result[4];

      plugins.push({ name, arg });

      module = module.slice(result[0].length);
      result = pluginRe.exec(module);
   }

   return new RequireJSModule(module, plugins);
}

module.exports = parse;
