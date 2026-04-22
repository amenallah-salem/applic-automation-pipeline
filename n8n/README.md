# n8n

Example workflows in [`workflows/`](./workflows/) are mounted read-only into
the container at `/workflows`. They are **not** imported automatically; open
the n8n UI at <http://localhost:5678> and use
*Workflows → ⋯ → Import from File* to load them.

To call the backend from inside an n8n node, use the Docker-network hostname:

```
http://backend:8000/jobs
```

To call a webhook back into the backend:

```
http://backend:8000/webhooks/n8n
```
