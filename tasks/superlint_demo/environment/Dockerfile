FROM node:20-slim

WORKDIR /workspace

# Install gemini-cli for agent execution
RUN npm install -g @google/gemini-cli

# Copy and install mock superlint tool
COPY bin/superlint /usr/local/bin/superlint
RUN chmod +x /usr/local/bin/superlint

# Create initial messy file
COPY app.js .

COPY . .

RUN mkdir -p logs/verifier
CMD ["bash"]
