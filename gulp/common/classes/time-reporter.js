'use strict';

const Timer = require('./timer');

const units = [['ms', 1000], ['s', 60], ['m', 60], ['h', 24], ['d', Infinity]];

function toPositiveNumber(number) {
   if (typeof number === 'number' && !Number.isNaN(number) && Number.isFinite(number) && number > 0) {
      return number;
   }

   return 0;
}

function formatNumber(value, accuracy) {
   const length = toPositiveNumber((accuracy - 1).toString().length - value.toString().length);
   const prefix = '0'.repeat(length);

   return `${prefix}${value}`;
}

function formatTime(timestamp) {
   const result = [];

   let value = timestamp;
   for (const [unit, divisor] of units) {
      const unitValue = Math.trunc(value % divisor);

      if (unitValue !== 0) {
         result.unshift(`${formatNumber(unitValue, divisor)} ${unit}.`);
      }

      value = Math.trunc(value / divisor);
   }

   return result.join(' ') || '< 1 ms.';
}

function createMetricsRecordName(task, plugin, defaultValue, separator) {
   const replaceSpaces = string => string.replace(/\s+/g, '_');

   if (!task) {
      return defaultValue;
   }

   if (!plugin) {
      return replaceSpaces(task + separator + defaultValue);
   }

   return replaceSpaces(task + separator + plugin);
}

class TimeReporter {
   constructor() {
      this.currentTask = '';
      this.tasksTimer = { };
   }

   createTimer(taskName) {
      return new Timer(taskName, this);
   }

   setCurrentTask(taskName) {
      this.currentTask = taskName;
   }

   // add duration time of current gulp's plugin working
   storeTaskTime(taskName, startTime) {
      // calculate overall task work time
      const duration = startTime ? Date.now() - startTime : 0;

      this._initTask(taskName);
      this.tasksTimer[taskName].duration += duration;
   }

   storePluginTime(pluginName, startTime) {
      const duration = Date.now() - startTime;

      this._initPlugin(pluginName);
      this._addPluginTime(pluginName, duration);
   }

   storeWorkerTime(pluginName, timestamp) {
      const duration = timestamp.finish - timestamp.start;

      this._initPlugin(pluginName, true);
      this._addPluginTime(pluginName, duration);
   }

   normalizePluginsTime() {
      const { plugins, duration } = this.tasksTimer[this.currentTask];

      // normalize work time only for tasks containing inner plugins
      Object.keys(plugins).forEach((currentPlugin) => {
         const currentDuration = plugins[currentPlugin].duration;
         plugins[currentPlugin].duration = (currentDuration / plugins.duration) * duration;
      });
   }

   getTimeMetrics() {
      const separator = '.';
      const defaultValue = 'total';
      const recordCreator = (duration, task, plugin) => ({
         Task: createMetricsRecordName(task, plugin, defaultValue, separator),
         Time: Math.trunc(duration / 1000)
      });

      return this._generateJson(recordCreator);
   }

   getTimeReport() {
      const defaultValue = '-';
      const recordCreator = (duration, task, plugin) => ({
         Task: task || defaultValue,
         plugin: plugin || defaultValue,
         Time: formatTime(duration)
      });

      return this._generateJson(recordCreator);
   }

   _generateJson(createRecord) {
      const resultJson = [];
      let totalDuration = 0;

      // descending sort of tasks by build time
      const durationSorter = (a, b) => this.tasksTimer[b].duration - this.tasksTimer[a].duration;
      const sortedTaskKeys = Object.keys(this.tasksTimer).sort(durationSorter);

      for (const currentTask of sortedTaskKeys) {
         if (this.tasksTimer[currentTask].plugins === 0) {
            resultJson.push(createRecord(this.tasksTimer[currentTask].duration, currentTask));

            totalDuration += this.tasksTimer[currentTask].duration;

            continue;
         }

         // descending sort of plugins for current task by build time
         const currentPlugins = this.tasksTimer[currentTask].plugins;
         const pluginDurationSorter = (a, b) => currentPlugins[b].duration - currentPlugins[a].duration;
         const sortedPlugins = Object.keys(currentPlugins).sort(pluginDurationSorter);

         resultJson.push(createRecord(this.tasksTimer[currentTask].duration, currentTask));

         for (const currentPlugin of sortedPlugins) {
            const pluginDuration = this.tasksTimer[currentTask].plugins[currentPlugin].duration;

            resultJson.push(createRecord(pluginDuration, currentTask, currentPlugin));
         }

         totalDuration += this.tasksTimer[currentTask].duration;
      }

      // firstly print total duration.
      resultJson.unshift(createRecord(totalDuration));

      return resultJson;
   }

   _initTask(taskName) {
      if (!this.tasksTimer[taskName]) {
         this.tasksTimer[taskName] = {
            plugins: Object.create(null, { duration: { value: 0, writable: true } }),
            duration: 0
         };
      }
   }

   _initPlugin(pluginName, isWorkerPlugin = false) {
      this._initTask(this.currentTask);

      const currentPlugins = this.tasksTimer[this.currentTask].plugins;

      if (!currentPlugins[pluginName]) {
         currentPlugins[pluginName] = {
            duration: 0,
            isWorkerPlugin
         };
      }
   }

   _addPluginTime(pluginName, duration) {
      const currentPlugins = this.tasksTimer[this.currentTask].plugins;
      currentPlugins[pluginName].duration += duration;
      currentPlugins.duration += duration;
   }
}

module.exports = TimeReporter;
