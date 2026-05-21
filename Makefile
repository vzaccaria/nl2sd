.PHONY: all build clean install dev

all: build

build: node_modules
	npx tsc

node_modules: package.json
	npm install
	touch node_modules

clean:
	rm -rf dist

install: build
	npm link

dev:
	npx ts-node src/index.ts
