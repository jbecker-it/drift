#!/bin/sh
APP_HOME=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -z "$JAVA_HOME" ]; then JAVA_CMD=java; else JAVA_CMD="$JAVA_HOME/bin/java"; fi
exec "$JAVA_CMD" $JAVA_OPTS $GRADLE_OPTS -classpath "$APP_HOME/gradle/wrapper/gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain "$@"
