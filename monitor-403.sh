#!/bin/bash

# Monitor script for 403 errors
# This will watch the server logs and highlight 403 errors

echo "🔍 Monitoring for 403 errors..."
echo "📝 Watching: server-log.txt"
echo ""
echo "Press Ctrl+C to stop"
echo ""
echo "─────────────────────────────────────────────────────────"
echo ""

# Color codes
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Watch the log file and highlight 403 errors
tail -f server-log.txt 2>/dev/null | while read line; do
    if [[ $line == *"403"* ]]; then
        echo -e "${RED}🚨 $line${NC}"
    elif [[ $line == *"FORBIDDEN"* ]]; then
        echo -e "${RED}⛔ $line${NC}"
    elif [[ $line == *"Error Message:"* ]]; then
        echo -e "${YELLOW}💬 $line${NC}"
    elif [[ $line == *"Possible causes:"* ]]; then
        echo -e "${BLUE}💡 $line${NC}"
    elif [[ $line == *"Check:"* ]]; then
        echo -e "${GREEN}🔗 $line${NC}"
    else
        echo "$line"
    fi
done

