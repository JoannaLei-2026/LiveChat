# Python 3.11 Slim Base Image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Prevent Python from writing .pyc files & buffer stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Copy requirements and install dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY . .

# Expose Python FastAPI port
EXPOSE 8000

# Start server
CMD ["python", "main.py"]
