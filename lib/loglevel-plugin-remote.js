"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;

var _regenerator = _interopRequireDefault(require("@babel/runtime/regenerator"));

var _asyncToGenerator2 = _interopRequireDefault(require("@babel/runtime/helpers/asyncToGenerator"));

var _typeof2 = _interopRequireDefault(require("@babel/runtime/helpers/typeof"));

// eslint-disable-next-line no-restricted-globals
var win = self;

if (!win) {
  throw new Error('Plugin for browser usage only');
}

var CIRCULAR_ERROR_MESSAGE; // https://github.com/nodejs/node/blob/master/lib/util.js

function tryStringify(arg) {
  try {
    return JSON.stringify(arg);
  } catch (error) {
    // Populate the circular error message lazily
    if (!CIRCULAR_ERROR_MESSAGE) {
      try {
        var a = {};
        a.a = a;
        JSON.stringify(a);
      } catch (circular) {
        CIRCULAR_ERROR_MESSAGE = circular.message;
      }
    }

    if (error.message === CIRCULAR_ERROR_MESSAGE) {
      return '[Circular]';
    }

    throw error;
  }
}

function getConstructorName(obj) {
  if (!Object.getOwnPropertyDescriptor || !Object.getPrototypeOf) {
    return Object.prototype.toString.call(obj).slice(8, -1);
  } // https://github.com/nodejs/node/blob/master/lib/internal/util.js


  while (obj) {
    var descriptor = Object.getOwnPropertyDescriptor(obj, 'constructor');

    if (descriptor !== undefined && typeof descriptor.value === 'function' && descriptor.value.name !== '') {
      return descriptor.value.name;
    }

    obj = Object.getPrototypeOf(obj);
  }

  return '';
}

function interpolate(array) {
  var result = '';
  var index = 0;

  if (array.length > 1 && typeof array[0] === 'string') {
    result = array[0].replace(/(%?)(%([sdjo]))/g, function (match, escaped, ptn, flag) {
      if (!escaped) {
        index += 1;
        var arg = array[index];
        var a = '';

        switch (flag) {
          case 's':
            a += arg;
            break;

          case 'd':
            a += +arg;
            break;

          case 'j':
            a = tryStringify(arg);
            break;

          case 'o':
            {
              var obj = tryStringify(arg);

              if (obj[0] !== '{' && obj[0] !== '[') {
                obj = "<".concat(obj, ">");
              }

              a = getConstructorName(arg) + obj;
              break;
            }
        }

        return a;
      }

      return match;
    }); // update escaped %% values

    result = result.replace(/%{2,2}/g, '%');
    index += 1;
  } // arguments remaining after formatting


  if (array.length > index) {
    if (result) result += ' ';
    result += array.slice(index).join(' ');
  }

  return result;
}

var hasOwnProperty = Object.prototype.hasOwnProperty; // Light deep Object.assign({}, ...sources)

function assign() {
  var target = {};

  for (var s = 0; s < arguments.length; s += 1) {
    var source = Object(arguments[s]);

    for (var key in source) {
      if (hasOwnProperty.call(source, key)) {
        target[key] = (0, _typeof2["default"])(source[key]) === 'object' && !Array.isArray(source[key]) ? assign(target[key], source[key]) : source[key];
      }
    }
  }

  return target;
}

function getStacktrace() {
  try {
    throw new Error();
  } catch (trace) {
    return trace.stack;
  }
}

function Queue(capacity) {
  var _this = this;

  var queue = [];
  var sent = [];

  this.length = function () {
    return queue.length;
  };

  this.sent = function () {
    return sent.length;
  };

  this.push = function (message) {
    queue.push(message);

    if (queue.length > capacity) {
      queue.shift();
    }
  };

  this.send = function () {
    if (!sent.length) {
      sent = queue;
      queue = [];
    }

    return sent;
  };

  this.confirm = function () {
    sent = [];
    _this.content = '';
  };

  this.fail = function () {
    var overflow = 1 + queue.length + sent.length - capacity;

    if (overflow > 0) {
      sent.splice(0, overflow);
      queue = sent.concat(queue);

      _this.confirm();
    } // if (queue.length + sent.length >= capacity) this.confirm();

  };
}

var hasStacktraceSupport = !!getStacktrace();
var loglevel;
var originalFactory;
var pluginFactory;

function plain(log) {
  return "[".concat(log.timestamp, "] ").concat(log.level.label.toUpperCase()).concat(log.logger ? " (".concat(log.logger, ")") : '', ": ").concat(log.message).concat(log.stacktrace ? "\n".concat(log.stacktrace) : '');
}

function json(log) {
  log.level = log.level.label;
  return log;
}

function setToken() {
  throw new Error("You can't set token for a not appled plugin");
}

function sleep(ms) {
  return new Promise(function (resolve) {
    return setTimeout(resolve, ms);
  });
}

var save = win.remote;
var defaultCapacity = 500;
var defaults = {
  url: '/logger',
  method: 'POST',
  headers: {},
  token: '',
  onUnauthorized: function onUnauthorized() {},
  timeout: 0,
  interval: 1000,
  level: 'trace',
  backoff: {
    multiplier: 2,
    jitter: 0.1,
    limit: 30000
  },
  capacity: 0,
  stacktrace: {
    levels: ['trace', 'warn', 'error'],
    depth: 3,
    excess: 0
  },
  timestamp: function timestamp() {
    return new Date().toISOString();
  },
  format: plain
};
var remote = {
  noConflict: function noConflict() {
    if (win.remote === remote) {
      win.remote = save;
    }

    return remote;
  },
  plain: plain,
  json: json,
  apply: function apply(logger, options) {
    if (!logger || !logger.getLogger) {
      throw new TypeError('Argument is not a root loglevel object');
    }

    if (loglevel) {
      throw new Error('You can assign a plugin only one time');
    }

    if (!win.XMLHttpRequest) return logger;
    loglevel = logger;
    var config = assign(defaults, options);
    config.capacity = config.capacity || defaultCapacity;
    var backoff = config.backoff;
    var backoffFunc = (0, _typeof2["default"])(backoff) === 'object' ? function (duration) {
      var next = duration * backoff.multiplier;
      if (next > backoff.limit) next = backoff.limit;
      next += next * backoff.jitter * Math.random();
      return next;
    } : backoff;
    var interval = config.interval;
    var contentType;
    var isJSON;
    var isSending = false;
    var isSuspended = false;
    var queue = new Queue(config.capacity);

    function send() {
      return _send.apply(this, arguments);
    }

    function _send() {
      _send = (0, _asyncToGenerator2["default"])( /*#__PURE__*/_regenerator["default"].mark(function _callee() {
        var logs, xhr, headers, header, value, suspend, timeout;
        return _regenerator["default"].wrap(function _callee$(_context) {
          while (1) {
            switch (_context.prev = _context.next) {
              case 0:
                suspend = function _suspend(successful) {
                  if (!successful) {
                    // interval = config.backoff(interval || 1);
                    interval = backoffFunc(interval || 1);
                    queue.fail();
                  }

                  isSuspended = true;
                  win.setTimeout(function () {
                    isSuspended = false;
                    send();
                  }, interval);
                };

                if (!(isSuspended || isSending || config.token === undefined)) {
                  _context.next = 3;
                  break;
                }

                return _context.abrupt("return");

              case 3:
                if (queue.sent()) {
                  _context.next = 8;
                  break;
                }

                if (queue.length()) {
                  _context.next = 6;
                  break;
                }

                return _context.abrupt("return");

              case 6:
                logs = queue.send();
                queue.content = isJSON ? "{\"logs\":[".concat(logs.join(','), "]}") : logs.join('\n');

              case 8:
                if (!(config.token === '')) {
                  _context.next = 13;
                  break;
                }

                _context.next = 11;
                return sleep(5000);

              case 11:
                config.onUnauthorized();
                return _context.abrupt("return");

              case 13:
                isSending = true;
                xhr = new win.XMLHttpRequest();
                xhr.open(config.method, config.url, true);
                xhr.setRequestHeader('Content-Type', contentType);

                if (config.token && !config.tokenlabel) {
                  xhr.setRequestHeader('Authorization', "Bearer ".concat(config.token));
                } else if (config.token && config.tokenlabel) {
                  xhr.setRequestHeader("".concat(config.tokenlabel), "".concat(config.token));
                }

                if (config.withCredentials) {
                  xhr.withCredentials = true;
                }

                headers = config.headers;

                for (header in headers) {
                  if (hasOwnProperty.call(headers, header)) {
                    value = headers[header];

                    if (value) {
                      xhr.setRequestHeader(header, value);
                    }
                  }
                }

                if (config.timeout) {
                  timeout = win.setTimeout(function () {
                    isSending = false;
                    xhr.abort();
                    suspend();
                  }, config.timeout);
                }

                xhr.onreadystatechange = function () {
                  if (xhr.readyState !== 4) {
                    return;
                  }

                  isSending = false;
                  win.clearTimeout(timeout);

                  if (xhr.status === 200) {
                    // eslint-disable-next-line prefer-destructuring
                    interval = config.interval;
                    queue.confirm();
                    suspend(true);
                  } else {
                    if (xhr.status === 401) {
                      var token = config.token;
                      config.token = undefined;
                      config.onUnauthorized(token);
                    }

                    suspend();
                  }
                };

                xhr.send(queue.content);

              case 24:
              case "end":
                return _context.stop();
            }
          }
        }, _callee);
      }));
      return _send.apply(this, arguments);
    }

    originalFactory = logger.methodFactory;

    pluginFactory = function remoteMethodFactory(methodName, logLevel, loggerName) {
      var rawMethod = originalFactory(methodName, logLevel, loggerName);
      var needStack = hasStacktraceSupport && config.stacktrace.levels.some(function (level) {
        return level === methodName;
      });
      var levelVal = loglevel.levels[methodName.toUpperCase()];
      var needLog = levelVal >= loglevel.levels[config.level.toUpperCase()];
      return function () {
        for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
          args[_key] = arguments[_key];
        }

        if (needLog || loggerName === 'Analytics') {
          var timestamp = config.timestamp();
          var stacktrace = needStack ? getStacktrace() : '';

          if (stacktrace) {
            var lines = stacktrace.split('\n');
            lines.splice(0, config.stacktrace.excess + 3);
            var depth = config.stacktrace.depth;

            if (depth && lines.length !== depth + 1) {
              var shrink = lines.splice(0, depth);
              stacktrace = shrink.join('\n');
              if (lines.length) stacktrace += "\n    and ".concat(lines.length, " more");
            } else {
              stacktrace = lines.join('\n');
            }
          }

          var log = config.format({
            message: interpolate(args),
            level: {
              label: methodName,
              value: levelVal
            },
            logger: loggerName || '',
            timestamp: timestamp,
            stacktrace: stacktrace
          });

          if (isJSON === undefined) {
            isJSON = typeof log !== 'string';
            contentType = isJSON ? 'application/json' : 'text/plain';
          }

          var content = '';

          if (isJSON) {
            try {
              content += JSON.stringify(log);
            } catch (error) {
              rawMethod.apply(void 0, args);
              loglevel.getLogger('logger').error(error);
              return;
            }
          } else {
            content += log;
          }

          queue.push(content);
          send();
        }

        if (loggerName !== 'Analytics') {
          rawMethod.apply(void 0, args);
        }
      };
    };

    logger.methodFactory = pluginFactory;
    logger.setLevel(logger.getLevel());

    remote.setToken = function (token) {
      config.token = token;
      send();
    };

    return logger;
  },
  disable: function disable() {
    if (!loglevel) {
      throw new Error("You can't disable a not appled plugin");
    }

    if (pluginFactory !== loglevel.methodFactory) {
      throw new Error("You can't disable a plugin after appling another plugin");
    }

    loglevel.methodFactory = originalFactory;
    loglevel.setLevel(loglevel.getLevel());
    loglevel = undefined;
    remote.setToken = setToken;
  },
  setToken: setToken
};
var _default = remote;
exports["default"] = _default;
module.exports = exports.default;
