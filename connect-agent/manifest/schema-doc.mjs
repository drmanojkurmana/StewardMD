/* connect-agent/manifest/schema-doc.mjs — schema.json as a plain ES module.
 *
 * GENERATED from schema.json by scripts/gen-schema-doc.mjs. Do not hand-edit; edit schema.json and
 * regenerate. test/connect-schema-doc.test.mjs fails if the two ever drift.
 *
 * WHY THIS FILE EXISTS. schema.mjs used to read the document with
 *   import SCHEMA_DOC from './schema.json' with { type: 'json' };
 * which is correct for Node >= 22 and is the only form Node accepts, but the esbuild that
 * Cloudflare Pages runs to bundle Functions is older than import attributes and stops at the
 * 'with':
 *   ERROR Expected ";" but found "with"  ../connect-agent/manifest/schema.mjs:83:39
 * That single parse error failed the FUNCTIONS build, which failed the whole Pages build, on every
 * push for weeks. Cloudflare kept serving the last good deployment, so the site looked healthy while
 * main silently stopped reaching production. It never showed up locally because a current wrangler
 * bundles with a newer esbuild that accepts the syntax.
 *
 * A plain 'export default' needs no attribute, so both runtimes agree and schema.json stays the
 * document of record. */
export default {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://stewardmd.in/schema/connect/agent-manifest/3.json",
  "title": "StewardMD Connect agent adapter manifest",
  "description": "Versioned, declarative description of the READ operations an approved hospital adapter may execute. Carries no credentials, no cookies and no patient values: origins are referenced by id, path instances are typed placeholders, and response mapping is a closed transform vocabulary. schemaVersion 1/2 are the legacy discovery artifacts validated by connect-agent/controller.mjs#validateAdapterSpec; 3 is this manifest.",
  "x-stewardmd": {
    "schemaVersion": 3,
    "operationTypes": [
      "list_worklist",
      "get_patient_summary",
      "list_medications",
      "list_allergies",
      "list_results",
      "list_encounters",
      "list_notes"
    ],
    "methods": [
      "GET",
      "HEAD"
    ],
    "transforms": [
      "pick",
      "map",
      "toDate",
      "toNumber",
      "coalesce",
      "const"
    ],
    "responseFormats": [
      "json",
      "html"
    ],
    "placeholderTypes": [
      "id",
      "int",
      "token"
    ],
    "resources": [
      "patient",
      "worklist",
      "encounters",
      "medications",
      "allergies",
      "observations",
      "documents"
    ],
    "paginationStyles": [
      "none",
      "page",
      "offset"
    ],
    "constAllowlist": [
      "laboratory",
      "vital-signs",
      "imaging",
      "procedure",
      "survey",
      "exam",
      "therapy",
      "activity",
      "social-history",
      "active",
      "inactive",
      "completed",
      "stopped",
      "unknown",
      "final",
      "preliminary",
      "registered",
      "amended",
      "entered-in-error",
      "current",
      "resolved",
      "on-hold",
      "not-taken",
      "low",
      "high",
      "unable-to-assess",
      "statement",
      "order",
      "administration",
      "inpatient",
      "outpatient",
      "emergency",
      "ambulatory",
      "male",
      "female",
      "other"
    ],
    "limits": {
      "maxOperations": 32,
      "maxFieldsPerOperation": 24,
      "maxPathTemplateLength": 512,
      "maxQueryKeys": 12,
      "maxPagesCeiling": 20,
      "maxItemsCeiling": 2000,
      "maxCoalesceBranches": 4,
      "maxMapTableEntries": 32,
      "maxSelectorDepth": 6,
      "maxHtmlSelectorLength": 200,
      "maxHtmlCellIndex": 200,
      "maxHtmlOnclickArg": 20
    },
    "forbiddenKeys": [
      "__proto__",
      "constructor",
      "prototype"
    ]
  },
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "manifestId",
    "origins",
    "operations",
    "unsupported",
    "capabilityProbes",
    "provenance",
    "contentHash"
  ],
  "properties": {
    "schemaVersion": {
      "const": 3
    },
    "manifestId": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9._-]{0,63}$"
    },
    "origins": {
      "type": "array",
      "minItems": 1,
      "maxItems": 8,
      "description": "Approved origin REFERENCES. An entry is an id plus the http(s) origin string only. Never a cookie, header, token or credential.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "origin"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^origin:[a-z0-9][a-z0-9._-]{0,31}$"
          },
          "origin": {
            "type": "string"
          },
          "role": {
            "enum": [
              "ui",
              "api"
            ]
          }
        }
      }
    },
    "operations": {
      "type": "array",
      "maxItems": 32,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "type",
          "method",
          "originId",
          "pathTemplate",
          "placeholders",
          "allowedQueryKeys",
          "pagination",
          "mapping",
          "sessionExpiry"
        ],
        "properties": {
          "type": {
            "enum": [
              "list_worklist",
              "get_patient_summary",
              "list_medications",
              "list_allergies",
              "list_results",
              "list_encounters",
              "list_notes"
            ]
          },
          "method": {
            "enum": [
              "GET",
              "HEAD"
            ]
          },
          "responseFormat": {
            "enum": [
              "json",
              "html"
            ],
            "description": "How the response body is parsed. 'json' (default when absent) parses JSON and selects items via mapping.itemsSelector. 'html' parses the markup and extracts records via htmlExtract, for legacy server-rendered EMRs."
          },
          "htmlExtract": {
            "type": "object",
            "additionalProperties": false,
            "description": "Required when responseFormat is 'html'. Turns markup into flat string records the mapping then transforms. rows selects each record's container; fields pull raw strings by cell index, a scoped selector, or a quoted argument of an on* handler.",
            "required": [
              "rows",
              "fields"
            ],
            "properties": {
              "rows": {
                "type": "string",
                "maxLength": 200
              },
              "fields": {
                "type": "object",
                "additionalProperties": {
                  "$ref": "#/$defs/htmlRule"
                }
              }
            }
          },
          "originId": {
            "type": "string"
          },
          "pathTemplate": {
            "type": "string",
            "description": "Absolute path with {name} placeholders. No scheme, no host, no query, no fragment, no dot segments.",
            "pattern": "^/[^?#\\s]*$"
          },
          "placeholders": {
            "type": "object",
            "additionalProperties": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "type"
              ],
              "properties": {
                "type": {
                  "enum": [
                    "id",
                    "int",
                    "token"
                  ]
                },
                "description": {
                  "type": "string"
                }
              }
            }
          },
          "allowedQueryKeys": {
            "type": "array",
            "maxItems": 12,
            "items": {
              "type": "string",
              "pattern": "^[A-Za-z0-9_.-]{1,40}$"
            }
          },
          "pagination": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "style",
              "maxPages",
              "maxItems"
            ],
            "properties": {
              "style": {
                "enum": [
                  "none",
                  "page",
                  "offset"
                ]
              },
              "param": {
                "type": "string"
              },
              "sizeParam": {
                "type": "string"
              },
              "pageSize": {
                "type": "integer",
                "minimum": 1,
                "maximum": 500
              },
              "startAt": {
                "type": "integer",
                "minimum": 0
              },
              "maxPages": {
                "type": "integer",
                "minimum": 1,
                "maximum": 20
              },
              "maxItems": {
                "type": "integer",
                "minimum": 1,
                "maximum": 2000
              }
            }
          },
          "mapping": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "resource",
              "fields"
            ],
            "properties": {
              "resource": {
                "enum": [
                  "patient",
                  "worklist",
                  "encounters",
                  "medications",
                  "allergies",
                  "observations",
                  "documents"
                ]
              },
              "itemsSelector": {
                "type": "string",
                "description": "Dot selector to the array of items. Omitted for a single-object resource."
              },
              "fields": {
                "type": "object",
                "description": "canonical field path -> transform expression",
                "additionalProperties": {
                  "$ref": "#/$defs/expr"
                }
              }
            }
          },
          "sessionExpiry": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "statusCodes"
            ],
            "properties": {
              "statusCodes": {
                "type": "array",
                "items": {
                  "type": "integer",
                  "minimum": 100,
                  "maximum": 599
                }
              },
              "redirectPatterns": {
                "type": "array",
                "maxItems": 8,
                "items": {
                  "type": "string",
                  "maxLength": 120
                }
              }
            }
          },
          "suggested": {
            "type": "boolean",
            "description": "true when any field expression came from the suggest hook and survived validation."
          }
        }
      }
    },
    "capabilityProbes": {
      "type": "array",
      "maxItems": 32,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "operationType",
          "expect"
        ],
        "properties": {
          "operationType": {
            "type": "string"
          },
          "expect": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "minItems": {
                "type": "integer",
                "minimum": 0
              },
              "requiredFields": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            }
          }
        }
      }
    },
    "unsupported": {
      "type": "array",
      "maxItems": 64,
      "description": "Explicit, reasoned gaps. Anything the compiler could not derive deterministically lands here instead of being guessed.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "capability",
          "reason"
        ],
        "properties": {
          "capability": {
            "type": "string",
            "maxLength": 64
          },
          "reason": {
            "type": "string",
            "maxLength": 240
          },
          "observedPath": {
            "type": "string",
            "maxLength": 512
          }
        }
      }
    },
    "provenance": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "discoverySpecHash",
        "compilerVersion",
        "generatedAt"
      ],
      "properties": {
        "discoverySpecHash": {
          "type": "string",
          "pattern": "^sha256:[0-9a-f]{64}$"
        },
        "compilerVersion": {
          "type": "string",
          "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$"
        },
        "generatedAt": {
          "type": "string"
        },
        "discoverySchemaVersion": {
          "type": "integer"
        }
      }
    },
    "contentHash": {
      "type": "string",
      "pattern": "^sha256:[0-9a-f]{64}$"
    }
  },
  "$defs": {
    "htmlRule": {
      "type": "object",
      "description": "Exactly one extraction: a table cell by index, a scoped selector's text/html/@attr, or a quoted argument of an on* handler. No code, no regular expressions.",
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "cell"
          ],
          "properties": {
            "cell": {
              "type": "integer",
              "minimum": 0,
              "maximum": 200
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "selector",
            "attr"
          ],
          "properties": {
            "selector": {
              "type": "string",
              "maxLength": 200
            },
            "attr": {
              "type": "string",
              "maxLength": 48
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "onclickArg"
          ],
          "properties": {
            "onclickArg": {
              "type": "integer",
              "minimum": 0,
              "maximum": 20
            },
            "source": {
              "type": "string",
              "maxLength": 48
            }
          }
        }
      ]
    },
    "selector": {
      "type": "string",
      "description": "Dot path over the response object. Segments are literal keys or non-negative array indices. No wildcards, no expressions, no function calls.",
      "pattern": "^[A-Za-z0-9_-]+(\\.[A-Za-z0-9_-]+)*$"
    },
    "expr": {
      "type": "object",
      "description": "Closed transform vocabulary. Exactly one of pick|map|toDate|toNumber|coalesce|const. No code, no expressions, no regular expressions.",
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "op",
            "path"
          ],
          "properties": {
            "op": {
              "const": "pick"
            },
            "path": {
              "$ref": "#/$defs/selector"
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "op",
            "path",
            "table"
          ],
          "properties": {
            "op": {
              "const": "map"
            },
            "path": {
              "$ref": "#/$defs/selector"
            },
            "table": {
              "type": "object",
              "additionalProperties": {
                "type": "string"
              }
            },
            "default": {
              "type": [
                "string",
                "null"
              ]
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "op",
            "path",
            "timezone"
          ],
          "properties": {
            "op": {
              "const": "toDate"
            },
            "path": {
              "$ref": "#/$defs/selector"
            },
            "timezone": {
              "type": "string",
              "description": "IANA zone applied to a naive timestamp. Required: there is no implicit local zone."
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "op",
            "path",
            "unit"
          ],
          "properties": {
            "op": {
              "const": "toNumber"
            },
            "path": {
              "$ref": "#/$defs/selector"
            },
            "unit": {
              "type": "string",
              "maxLength": 24
            },
            "unitPath": {
              "$ref": "#/$defs/selector"
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "op",
            "of"
          ],
          "properties": {
            "op": {
              "const": "coalesce"
            },
            "of": {
              "type": "array",
              "minItems": 1,
              "maxItems": 4,
              "items": {
                "$ref": "#/$defs/expr"
              }
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "op",
            "value"
          ],
          "properties": {
            "op": {
              "const": "const"
            },
            "value": {
              "type": "string",
              "description": "Restricted to x-stewardmd.constAllowlist so a literal can never smuggle an observed value into the manifest."
            }
          }
        }
      ]
    }
  }
};
