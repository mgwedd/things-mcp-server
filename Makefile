.PHONY: install build test lint clean
install:
	npm install
build:
	npm run build
test:
	npm test
lint:
	npm run lint
clean:
	rm -rf dist node_modules
