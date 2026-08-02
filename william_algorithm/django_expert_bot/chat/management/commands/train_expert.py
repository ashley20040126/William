from django.core.management.base import BaseCommand
from chat.experts import get_expert_by_id, EXPERTS_LIST
import asyncio
import os
from pathlib import Path

# Try to import ingest from our core library
try:
    from expert_panel_project.lightrag_core.rag_factory import ingest
except ImportError:
    try:
        from lightrag_core.rag_factory import ingest
    except ImportError:
        ingest = None

class Command(BaseCommand):
    help = 'Ingest documents for a specific expert to build their knowledge base'

    def add_arguments(self, parser):
        parser.add_argument('expert_id', type=str, help='The ID of the expert (e.g., lawyer, coder)')
        parser.add_argument('input_path', type=str, help='Path to the directory or file containing documents')

    def handle(self, *args, **options):
        expert_id = options['expert_id']
        input_path = options['input_path']

        expert = get_expert_by_id(expert_id)
        if not expert:
            self.stderr.write(self.style.ERROR(f"Expert '{expert_id}' not found. Available: {[e.id for e in EXPERTS_LIST]}"))
            return

        if not os.path.exists(input_path):
            self.stderr.write(self.style.ERROR(f"Input path '{input_path}' does not exist."))
            return

        if ingest is None:
            self.stderr.write(self.style.ERROR("Core RAG library not found. Cannot ingest."))
            return

        self.stdout.write(self.style.SUCCESS(f"Starting ingestion for expert: {expert.name} ({expert.title})"))
        self.stdout.write(f"Source: {input_path}")
        self.stdout.write(f"Target Storage: {expert.storage_dir}")
        self.stdout.write(f"Output Logs: {expert.storage_dir}/output") # Assuming output dir shares parent or is distinct

        # Ensure output dir exists
        output_dir = Path(expert.storage_dir) / "output"
        output_dir.mkdir(parents=True, exist_ok=True)

        try:
            asyncio.run(ingest(
                input_path=input_path,
                working_dir=expert.storage_dir,
                output_dir=str(output_dir),
                device="cpu" 
            ))
            self.stdout.write(self.style.SUCCESS("✅ Ingestion complete!"))
        except Exception as e:
            self.stderr.write(self.style.ERROR(f"Ingestion failed: {e}"))
