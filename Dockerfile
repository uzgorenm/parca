FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 TERM=xterm-256color

RUN apt-get update && apt-get install -y --no-install-recommends \
    tmux git curl sudo python3 python3-pip python3-venv ca-certificates \
    build-essential ripgrep fd-find unzip wget \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g @anthropic-ai/claude-code \
    && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /root/.npm

# Neovim binary
RUN curl -fsSL https://github.com/neovim/neovim/releases/download/v0.11.2/nvim-linux-arm64.tar.gz \
    | tar xz -C /opt \
    && ln -s /opt/nvim-linux-arm64/bin/nvim /usr/local/bin/nvim

# fd-find is installed as fdfind on Ubuntu, LazyVim expects fd
RUN ln -s $(which fdfind) /usr/local/bin/fd

# User setup
RUN useradd -m -s /bin/bash -u 501 dev\
    && echo "dev ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
    && mkdir -p /home/dev/.local/bin /home/dev/.local/state /home/dev/.local/share \
    && ln -s $(which claude) /home/dev/.local/bin/claude \
    && chown -R dev:dev /home/dev

RUN echo "set -g mouse on" > /etc/tmux.conf

USER dev
