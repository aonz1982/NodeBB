(function (module) {

	var config = {},
		templates,
		fs = null,
		available_templates = [],
		parsed_variables = {};

	module.exports = templates = {};

	try {
		fs = require('fs');
	} catch (e) {}

	templates.force_refresh = function (tpl) {
		return !!config.force_refresh[tpl];
	}

	templates.get_custom_map = function (tpl) {
		if (config['custom_mapping'] && tpl) {
			for (var pattern in config['custom_mapping']) {
				if (tpl.match(pattern)) {
					return (config['custom_mapping'][pattern]);
				}
			}
		}

		return false;
	}

	templates.is_available = function (tpl) {
		return jQuery.inArray(tpl, available_templates) !== -1;
	};

	templates.ready = function (callback) {
		if (callback == null) {
			if (this.ready_callback) {
				this.ready_callback();
			} else {
				this.loaded = true;
			}
		} else {
			if (this.loaded == true) {
				callback();
			} else {
				this.ready_callback = callback;
			}
		}
	};

	templates.prepare = function (raw_tpl, data) {
		var template = {};
		template.html = raw_tpl;
		template.parse = parse;
		template.blocks = {};

		return template;
	};

	function loadTemplates(templatesToLoad, customTemplateDir) {
		function loadServer() {
			var loaded = templatesToLoad.length;

			function getTemplates(directory) {
				for (var t in templatesToLoad) {
					(function (file) {
						fs.readFile(directory + '/' + file + '.tpl', function (err, html) {
							var template = function () {
								this.toString = function () {
									return this.html;
								};
							}

							template.prototype.file = file;
							template.prototype.parse = parse;
							template.prototype.html = String(html);

							global.templates[file] = new template;

							loaded--;
							if (loaded == 0) templates.ready();
						});
					}(templatesToLoad[t]));
				}
			}
			if (customTemplateDir) {
				fs.exists(customTemplateDir, function (exists) {
					var directory = (exists ? customTemplateDir : __dirname + '/../templates');
					getTemplates(directory);
				});
			} else {
				getTemplates(__dirname + '/../templates');
			}

		}

		function loadClient() {
			jQuery.when(jQuery.getJSON(RELATIVE_PATH + '/templates/config.json'), jQuery.getJSON(RELATIVE_PATH + '/api/get_templates_listing')).done(function (config_data, templates_data) {
				config = config_data[0];
				available_templates = templates_data[0];
				templates.ready();
			});
		}

		if (fs === null) loadClient();
		else loadServer();
	}


	templates.init = function (templates_to_load, custom_templates) {
		loadTemplates(templates_to_load || [], custom_templates || false);
	}

	templates.getTemplateNameFromUrl = function (url) {
		var parts = url.split('?')[0].split('/');

		for (var i = 0; i < parts.length; ++i) {
			if (templates.is_available(parts[i])) {
				return parts[i];
			}
		}
		return '';
	}

	templates.preload_template = function(tpl_name, callback) {

		if(templates[tpl_name]) {
			return callback();
		}

		// TODO: This should be "load_template", and the current load_template
		// should be named something else
		// TODO: The "Date.now()" in the line below is only there for development purposes.
		// It should be removed at some point.
		jQuery.get(RELATIVE_PATH + '/templates/' + tpl_name + '.tpl?v=' + Date.now(), function (html) {
			var template = function () {
				this.toString = function () {
					return this.html;
				};
			}

			template.prototype.parse = parse;
			template.prototype.html = String(html);
			template.prototype.blocks = {};

			templates[tpl_name] = new template;

			callback();
		});
	}

	templates.load_template = function (callback, url, template) {
		var location = document.location || window.location,
			api_url = (url === '' || url === '/') ? 'home' : url,
			tpl_url = templates.get_custom_map(api_url.split('?')[0]);

		if (!tpl_url) {
			tpl_url = templates.getTemplateNameFromUrl(api_url);
		}

		var template_data = null;

		var timestamp = new Date().getTime(); //debug

		if (!templates[tpl_url]) {
			templates.preload_template(tpl_url, function() {
				parse_template();
			});
		} else {
			parse_template();
		}

		jQuery.get(RELATIVE_PATH + '/api/' + api_url, function (data) {

			if (!data) {
				ajaxify.go('404');
				return;
			}

			template_data = data;
			parse_template();
		}).fail(function (data) {
			if (data && data.status == 404) {
				return ajaxify.go('404');
			} else if (data && data.status === 403) {
				return ajaxify.go('403');
			} else {
				app.alertError(data.responseJSON.error);
			}
		});

		function parse_template() {
			if (!templates[tpl_url] || !template_data) return;

			if (typeof global !== "undefined")
				template_data['relative_path'] = nconf.get('relative_path');
			else
				template_data['relative_path'] = RELATIVE_PATH;

			translator.translate(templates[tpl_url].parse(template_data), function (translatedTemplate) {

				$('#content').html(translatedTemplate);

				jQuery('#content [template-variable]').each(function (index, element) {
					var value = null;

					switch ($(element).attr('template-type')) {
						case 'boolean':
							value = ($(element).val() === 'true' || $(element).val() === '1') ? true : false;
							break;
						case 'int': // Intentional fall-through
						case 'integer':
							value = parseInt($(element).val());
							break;
						default:
							value = $(element).val();
							break;
					}

					templates.set($(element).attr('template-variable'), value);
				});

				if (callback) {
					callback(true);
				}
			});
		}

	}

	templates.flush = function () {
		parsed_variables = {};
	}

	templates.get = function (key) {
		return parsed_variables[key];
	}

	templates.set = function (key, value) {
		parsed_variables[key] = value;
	}

	//modified from https://github.com/psychobunny/dcp.templates
	var parse = function (data) {
		var self = this;

		function replace(key, value, template) {
			var searchRegex = new RegExp('{' + key + '}', 'g');
			return template.replace(searchRegex, value);
		}

		function makeRegex(block) {
			return new RegExp("<!--[\\s]*BEGIN " + block + "[\\s]*-->[\\s\\S]*<!--[\\s]*END " + block + "[\\s]*-->", 'g');
		}

		function makeConditionalRegex(block) {
			return new RegExp("<!--[\\s]*IF " + block + "[\\s]*-->([\\s\\S]*?)<!--[\\s]*ENDIF " + block + "[\\s]*-->", 'g');
		}

		function getBlock(regex, block, template) {
			data = template.match(regex);
			if (data == null) return;

			if (self.blocks && block !== undefined) self.blocks[block] = data[0];

			var begin = new RegExp("(\r\n)*<!-- BEGIN " + block + " -->(\r\n)*", "g"),
				end = new RegExp("(\r\n)*<!-- END " + block + " -->(\r\n)*", "g"),

			data = data[0]
				.replace(begin, "")
				.replace(end, "");

			return data;
		}

		function setBlock(regex, block, template) {
			return template.replace(regex, block);
		}

		var template = this.html,
			regex, block;

		return (function parse(data, namespace, template, blockInfo) {
			if (!data || data.length == 0) {
				template = '';
			}

			for (var d in data) {
				if (data.hasOwnProperty(d)) {
					if (typeof data[d] === 'undefined') {
						continue;
					} else if (data[d] === null) {
						template = replace(namespace + d, '', template);
					} else if (data[d].constructor == Array) {
						namespace += d + '.';

						var regex = makeRegex(d),
							block = getBlock(regex, namespace.substring(0, namespace.length - 1), template);

						if (block == null) {
							namespace = namespace.replace(d + '.', '');
							continue;
						}

						var numblocks = data[d].length - 1,
							i = 0,
							result = "";

						do {
							result += parse(data[d][i], namespace, block, {iterator: i, total: numblocks});
						} while (i++ < numblocks);

						namespace = namespace.replace(d + '.', '');
						template = setBlock(regex, result, template);
					} else if (data[d] instanceof Object) {
						template = parse(data[d], d + '.', template);
					} else {
						function checkConditional(key, value) {
							var conditional = makeConditionalRegex(key),
								matches = template.match(conditional);

							if (matches !== null) {
								for (var i = 0, ii = matches.length; i < ii; i++) {
									var conditionalBlock = matches[i].split(/<!-- ELSE -->/);

									if (conditionalBlock[1]) {
										// there is an else statement
										if (!value) {
											template = template.replace(matches[i], conditionalBlock[1].replace(/<!-- ((\IF\b)|(\bENDIF\b))([^@]*?)-->/gi, ''));
										} else {
											template = template.replace(matches[i], conditionalBlock[0].replace(/<!-- ((\IF\b)|(\bENDIF\b))([^@]*?)-->/gi, ''));
										}
									} else {
										// regular if statement
										if (!value) {
											template = template.replace(matches[i], '');
										} else {
											template = template.replace(matches[i], matches[i].replace(/<!-- ((\IF\b)|(\bENDIF\b))([^@]*?)-->/gi, ''));
										}
									}
								}
							}
						}

						checkConditional(namespace + d, data[d]);
						checkConditional('!' + namespace + d, !data[d]);

						if (blockInfo) {
							checkConditional('@first', blockInfo.iterator === 0);
							checkConditional('@last', blockInfo.iterator === blockInfo.total);
						}

						template = replace(namespace + d, data[d], template);
					}
				}
			}

			if (namespace) {
				var regex = new RegExp("{" + namespace + "[\\s\\S]*?}", 'g');
				template = template.replace(regex, '');
				namespace = '';
			}

			// clean up all undefined conditionals
			template = template.replace(/<!-- IF([^@]*?)ENDIF([^@]*?)-->/gi, '');

			return template;

		})(data, "", template);
	}

	if ('undefined' !== typeof window) {
		window.templates = module.exports;
		templates.init();
	}

})('undefined' === typeof module ? {
	module: {
		exports: {}
	}
} : module)
