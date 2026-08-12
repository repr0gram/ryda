DEVICE ?= Ryda Test
BUNDLE  = com.fadi.ryda

.PHONY: help bootstrap generate test build run device shot clean

help:
	@echo "make bootstrap   install xcodegen + the iOS simulator runtime"
	@echo "make generate    regenerate Ryda.xcodeproj from project.yml"
	@echo "make test        RydaKit unit tests — macOS, no simulator, ~1s"
	@echo "make build       build for the simulator"
	@echo "make run         build, install and launch on the simulator"
	@echo "make device      build and install on a connected iPhone"
	@echo "make shot        screenshot the booted simulator"
	@echo ""
	@echo "DEVICE=\"iPhone 17\" make run   to target a different simulator"

bootstrap:
	command -v xcodegen >/dev/null || brew install xcodegen
	xcrun simctl list runtimes | grep -q iOS || xcodebuild -downloadPlatform iOS
	test -f Local.xcconfig || cp Local.xcconfig.example Local.xcconfig
	$(MAKE) generate

generate:
	xcodegen generate

test:
	swift test --package-path RydaKit

build: generate
	xcodebuild -project Ryda.xcodeproj -scheme Ryda \
	  -destination 'platform=iOS Simulator,name=$(DEVICE)' \
	  -derivedDataPath build build

run: build
	xcrun simctl boot "$(DEVICE)" 2>/dev/null || true
	open -a Simulator
	xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/Ryda.app
	xcrun simctl launch booted $(BUNDLE)

# Needs the iPhone plugged in and trusted. Xcode registers the device with your
# team the first time, which is why this cannot be done ahead of the cable.
device: generate
	xcodebuild -project Ryda.xcodeproj -scheme Ryda \
	  -destination 'generic/platform=iOS' \
	  -derivedDataPath build-device \
	  -allowProvisioningUpdates build

shot:
	xcrun simctl io booted screenshot shot.png && echo "wrote ios/shot.png"

clean:
	rm -rf build build-device Ryda.xcodeproj
