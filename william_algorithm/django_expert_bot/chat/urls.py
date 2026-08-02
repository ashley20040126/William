from django.urls import path
from . import views

app_name = 'chat'

urlpatterns = [
    path('', views.index, name='index'),
    path('room/', views.chat_page, name='chat_new'),
    path('room/<str:session_id>/', views.chat_page, name='chat_room'),
    path('api/send/', views.chat_api, name='api_send'),
]
