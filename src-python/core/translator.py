"""
Translation module - Handles query translation using AI
"""
import openai
import os

# Initialize OpenAI Client with a placeholder, will be updated by Settings
client = openai.AsyncOpenAI(api_key="placeholder")
current_model = "deepseek-chat"

class Translator:
    def update_config(self, config: dict):
        """Update the OpenAI client configuration"""
        global client, current_model
        client = openai.AsyncOpenAI(
            api_key=config['apiKey'],
            base_url=config['baseUrl']
        )
        current_model = config['model']

    async def translate_query(self, query: str) -> str:
        """
        Translates Chinese query to English scientific keywords using AI
        """
        if not any('\u4e00' <= char <= '\u9fff' for char in query):
            return query

        print(f"DEBUG: Translating query: {query}")
        try:
            resp = await client.chat.completions.create(
                model=current_model,
                messages=[
                    {"role": "system", "content": "You are a scientific research assistant. Translate the following Chinese research query into professional English keywords for academic database search. Return ONLY the translated keywords, separated by spaces."},
                    {"role": "user", "content": query}
                ],
                temperature=0.3,
                timeout=10.0
            )
            translated = resp.choices[0].message.content.strip()
            print(f"DEBUG: Translation success: {translated}")
            return translated
        except Exception as e:
            print(f"DEBUG: Translation failed: {e}")
            return query

    async def translate_text(self, text: str, target_lang: str = "Chinese") -> str:
        """
        Translates scientific text to target language
        """
        if not text: return ""
        try:
            resp = await client.chat.completions.create(
                model=current_model,
                messages=[
                    {"role": "system", "content": f"You are a scientific research assistant. Translate the following scientific abstract into professional {target_lang}. Maintain the scientific terminology accuracy."},
                    {"role": "user", "content": text}
                ],
                temperature=0.3
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            print(f"Translation error: {e}")
            return text

# Singleton instance
translator = Translator()
