import pandas as pd
import io
from sqlalchemy.orm import Session
from .database import Literature
import json
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
import matplotlib.pyplot as plt


class DataExporter:
    def export_to_excel(self, db: Session, dois: list[str]) -> io.BytesIO:
        papers = db.query(Literature).filter(Literature.doi.in_(dois), Literature.is_extracted == True).all()

        export_data = []
        for paper in papers:
            perf = json.loads(paper.performance_data) if paper.performance_data else {}
            row = {
                "DOI": paper.doi,
                "Title": paper.title,
                "Journal": paper.journal,
                "Year": paper.year,
                "Composition": paper.composition,
                "Structure": paper.structure,
                "PCE (%)": perf.get("pce", "N/A"),
                "Voc (V)": perf.get("voc", "N/A"),
                "Jsc (mA/cm2)": perf.get("jsc", "N/A"),
                "FF (%)": perf.get("ff", "N/A"),
            }
            export_data.append(row)

        if not export_data:
            raise ValueError("No extracted data found for the selected papers")

        df = pd.DataFrame(export_data)

        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='SIA_Data')

            worksheet = writer.sheets['SIA_Data']
            for idx, col in enumerate(df.columns):
                max_len = max(df[col].astype(str).map(len).max(), len(col)) + 2
                worksheet.column_dimensions[chr(65 + idx)].width = min(max_len, 50)

        output.seek(0)
        return output

    def export_to_png(self, db: Session, dois: list[str]) -> io.BytesIO:
        """Export comparison table as PNG image (GAP-007)."""
        papers = db.query(Literature).filter(Literature.doi.in_(dois), Literature.is_extracted == True).all()

        if not papers:
            raise ValueError("No extracted data found for the selected papers")

        # Prepare data
        data = []
        for paper in papers:
            perf = json.loads(paper.performance_data) if paper.performance_data else {}
            row = {
                "Title": (paper.title[:30] + "...") if paper.title and len(paper.title) > 30 else (paper.title or "N/A"),
                "PCE": perf.get("pce", "-"),
                "Voc": perf.get("voc", "-"),
                "Jsc": perf.get("jsc", "-"),
                "FF": perf.get("ff", "-"),
            }
            data.append(row)

        # Create figure
        fig, ax = plt.subplots(figsize=(12, max(4, len(data) * 0.5 + 2)))
        ax.axis('off')

        # Create table
        columns = ["Title", "PCE (%)", "Voc (V)", "Jsc (mA/cm²)", "FF (%)"]
        cell_data = [[row["Title"], row["PCE"], row["Voc"], row["Jsc"], row["FF"]] for row in data]

        table = ax.table(
            cellText=cell_data,
            colLabels=columns,
            loc='center',
            cellLoc='center',
            colColours=['#3B82F6'] * len(columns),
        )

        # Style the table
        table.auto_set_font_size(False)
        table.set_fontsize(10)
        table.scale(1.2, 1.5)

        # Header styling
        for i, col in enumerate(columns):
            table[(0, i)].set_text_props(color='white', weight='bold')
            table[(0, i)].set_facecolor('#3B82F6')

        # Alternating row colors
        for i in range(1, len(cell_data) + 1):
            for j in range(len(columns)):
                if i % 2 == 0:
                    table[(i, j)].set_facecolor('#1E293B')
                else:
                    table[(i, j)].set_facecolor('#0F172A')
                table[(i, j)].set_text_props(color='#E2E8F0')

        # Add title
        plt.title('SIA Literature Comparison', fontsize=14, fontweight='bold', color='#F8FAFC', pad=20)
        fig.patch.set_facecolor('#020617')

        # Save to bytes
        output = io.BytesIO()
        plt.savefig(output, format='png', dpi=150, bbox_inches='tight', facecolor=fig.get_facecolor())
        plt.close(fig)
        output.seek(0)
        return output

    def export_to_svg(self, db: Session, dois: list[str]) -> io.BytesIO:
        """Export comparison table as SVG image (GAP-007)."""
        papers = db.query(Literature).filter(Literature.doi.in_(dois), Literature.is_extracted == True).all()

        if not papers:
            raise ValueError("No extracted data found for the selected papers")

        # Prepare data
        data = []
        for paper in papers:
            perf = json.loads(paper.performance_data) if paper.performance_data else {}
            row = {
                "Title": (paper.title[:30] + "...") if paper.title and len(paper.title) > 30 else (paper.title or "N/A"),
                "PCE": perf.get("pce", "-"),
                "Voc": perf.get("voc", "-"),
                "Jsc": perf.get("jsc", "-"),
                "FF": perf.get("ff", "-"),
            }
            data.append(row)

        # Create figure
        fig, ax = plt.subplots(figsize=(12, max(4, len(data) * 0.5 + 2)))
        ax.axis('off')

        # Create table
        columns = ["Title", "PCE (%)", "Voc (V)", "Jsc (mA/cm²)", "FF (%)"]
        cell_data = [[row["Title"], row["PCE"], row["Voc"], row["Jsc"], row["FF"]] for row in data]

        table = ax.table(
            cellText=cell_data,
            colLabels=columns,
            loc='center',
            cellLoc='center',
            colColours=['#3B82F6'] * len(columns),
        )

        # Style the table
        table.auto_set_font_size(False)
        table.set_fontsize(10)
        table.scale(1.2, 1.5)

        # Header styling
        for i, col in enumerate(columns):
            table[(0, i)].set_text_props(color='white', weight='bold')
            table[(0, i)].set_facecolor('#3B82F6')

        # Alternating row colors
        for i in range(1, len(cell_data) + 1):
            for j in range(len(columns)):
                if i % 2 == 0:
                    table[(i, j)].set_facecolor('#1E293B')
                else:
                    table[(i, j)].set_facecolor('#0F172A')
                table[(i, j)].set_text_props(color='#E2E8F0')

        # Add title
        plt.title('SIA Literature Comparison', fontsize=14, fontweight='bold', color='#F8FAFC', pad=20)
        fig.patch.set_facecolor('#020617')

        # Save to bytes
        output = io.BytesIO()
        plt.savefig(output, format='svg', bbox_inches='tight', facecolor=fig.get_facecolor())
        plt.close(fig)
        output.seek(0)
        return output

    def export_to_latex(self, db: Session, dois: list[str]) -> io.BytesIO:
        """Export comparison table as LaTeX code (GAP-007)."""
        papers = db.query(Literature).filter(Literature.doi.in_(dois), Literature.is_extracted == True).all()

        if not papers:
            raise ValueError("No extracted data found for the selected papers")

        # Prepare data
        rows = []
        for paper in papers:
            perf = json.loads(paper.performance_data) if paper.performance_data else {}
            row = {
                "DOI": paper.doi,
                "Title": paper.title or "N/A",
                "PCE": perf.get("pce", "-"),
                "Voc": perf.get("voc", "-"),
                "Jsc": perf.get("jsc", "-"),
                "FF": perf.get("ff", "-"),
            }
            rows.append(row)

        # Generate LaTeX code
        latex_code = """\\begin{table}[htbp]
\\centering
\\caption{Literature Performance Comparison}
\\label{tab:comparison}
\\begin{tabular}{lcccc}
\\hline
\\textbf{Title} & \\textbf{PCE (\\%)} & \\textbf{Voc (V)} & \\textbf{Jsc (mA/cm$^2$)} & \\textbf{FF (\\%)} \\\\
\\hline
"""
        for row in rows:
            title = row["Title"].replace("&", "\\&").replace("%", "\\%").replace("_", "\\_")
            latex_code += f"{title[:40]} & {row['PCE']} & {row['Voc']} & {row['Jsc']} & {row['FF']} \\\\\n"

        latex_code += """\\hline
\\end{tabular}
\\end{table}
"""

        output = io.BytesIO()
        output.write(latex_code.encode('utf-8'))
        output.seek(0)
        return output


exporter = DataExporter()
