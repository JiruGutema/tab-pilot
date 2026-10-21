# Tab Pilot — build, install and development helpers.
SHELL := /bin/bash
.DEFAULT_GOAL := help

ADDON_ID := $(shell node -p "require('./manifest.json').browser_specific_settings.gecko.id" 2>/dev/null)
VERSION  := $(shell node -p "require('./manifest.json').version" 2>/dev/null)
SLUG     := $(shell node -p "require('./manifest.json').name.toLowerCase().replace(/[^a-z0-9]+/g, '_')" 2>/dev/null)
ARTIFACT := web-ext-artifacts/$(SLUG)-$(VERSION).zip

FIREFOX_DIR ?= $(HOME)/.mozilla/firefox

# The profile marked Default=1 in profiles.ini (first one if several).
PROFILE_PATH := $(shell awk -F= '\
	/^\[/ { if (is_default && path) { print path; found = 1; exit } path = ""; is_default = 0; next } \
	$$1 == "Path" { path = $$2 } \
	$$1 == "Default" && $$2 == "1" { is_default = 1 } \
	END { if (!found && is_default && path) print path } \
' "$(FIREFOX_DIR)/profiles.ini" 2>/dev/null | head -n 1)
PROFILE ?= $(if $(PROFILE_PATH),$(if $(filter /%,$(PROFILE_PATH)),$(PROFILE_PATH),$(FIREFOX_DIR)/$(PROFILE_PATH)))

EXTENSIONS_DIR := $(PROFILE)/extensions
XPI            := $(EXTENSIONS_DIR)/$(ADDON_ID).xpi

.PHONY: help build package install uninstall run start lint test harness clean clean-all

help:
	@printf '%s\n' \
		"Tab Pilot $(VERSION)" \
		"" \
		"Usage: make <target> [PROFILE=/path/to/firefox/profile]" \
		"" \
		"  build      Package the extension into $(ARTIFACT)" \
		"  install    Build and install it into the Firefox profile" \
		"  uninstall  Remove it from the Firefox profile" \
		"  run        Launch Firefox with a temporary development profile" \
		"  test       Run the unit tests" \
		"  lint       Validate the extension with web-ext" \
		"  harness    Serve the UI harness at http://127.0.0.1:8765" \
		"  clean      Remove the current version's package" \
		"  clean-all  Remove every packaged zip" \
		"" \
		"Firefox profile: $(if $(PROFILE),$(PROFILE),<none found; set PROFILE=...>)"

build:
	npm run build

package: build

install: build
	@if [ -z "$(PROFILE)" ]; then echo "error: no Firefox profile found; pass PROFILE=/path/to/profile"; exit 1; fi
	@if [ ! -f "$(ARTIFACT)" ]; then echo "error: $(ARTIFACT) was not created"; exit 1; fi
	@mkdir -p "$(EXTENSIONS_DIR)"
	@rm -rf "$(EXTENSIONS_DIR)/$(ADDON_ID)"
	@cp "$(ARTIFACT)" "$(XPI)"
	@echo "Installed $(ADDON_ID) $(VERSION) -> $(XPI)"
	@echo "Restart Firefox to load it. Unsigned add-ons need Developer Edition/Nightly"
	@echo "or xpinstall.signatures.required=false in about:config."

uninstall:
	@if [ -z "$(PROFILE)" ]; then echo "error: no Firefox profile found; pass PROFILE=/path/to/profile"; exit 1; fi
	@rm -f "$(XPI)"
	@rm -rf "$(EXTENSIONS_DIR)/$(ADDON_ID)"
	@echo "Removed $(ADDON_ID) from $(PROFILE)"

run:
	npm start

start: run

lint:
	npm run lint

test:
	npm test

harness:
	python3 test/harness/serve.py

clean:
	rm -f "$(ARTIFACT)"

clean-all:
	rm -f web-ext-artifacts/*.zip
